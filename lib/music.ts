/** A playable track, as stored in the library and sent to the table. */
export interface Faixa {
  titulo: string;
  url: string;
  tipo: "youtube" | "audio";
  youtube_id?: string | null;
}

export type Canal = "musica" | "ambiente";

/** Playback state of one channel at a table (row of mesa_som). */
export interface SomState {
  canal: Canal;
  faixa: Faixa | null;
  fila: Faixa[];
  fila_idx: number;
  tocando: boolean;
  posicao: number;
  iniciado_em: string;
  repetir: boolean;
  volume: number;
  /** Goes up by one on every change (see som_controlar). */
  versao?: number;
  atualizado_em?: string;
}

/**
 * The newer of two states of the same channel. Realtime events and RPC
 * replies can arrive out of order; an older state must never win.
 */
export function newerSound(cur: SomState | null | undefined, next: SomState): SomState {
  if (!cur) return next;
  return Number(next.versao ?? 0) >= Number(cur.versao ?? 0) ? next : cur;
}

export type SomAcao = "tocar" | "pausar" | "continuar" | "buscar" | "proxima" | "anterior" | "parar" | "repetir" | "volume";

export interface SomControl {
  (canal: Canal, acao: SomAcao, dados?: Record<string, unknown>): Promise<void>;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|webm)(\?|#|$)/i;

export type ParsedLink = { ok: true; faixa: Omit<Faixa, "titulo">; tituloSugerido: string } | { ok: false; error: string };

/**
 * Accepts YouTube links (watch, youtu.be, shorts, embed, music.youtube) and
 * direct audio links. Dropbox and Google Drive share links are turned into
 * direct downloads.
 */
export function parseMusicLink(raw: string): ParsedLink {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Cole o link da música." };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { ok: false, error: "Use um link que comece com https://" };
  let u: URL;
  try {
    u = new URL(scheme ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "Esse link não parece válido." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Use um link que comece com https://" };
  const host = u.hostname.replace(/^www\.|^m\./, "");

  let ytId: string | null = null;
  if (host === "youtu.be") ytId = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") ytId = u.searchParams.get("v");
    else {
      const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      if (m) ytId = m[2];
    }
    if (!ytId && u.searchParams.get("list")) return { ok: false, error: "Esse é um link de playlist do YouTube. Adicione os vídeos um por um." };
  }
  if (ytId !== null) {
    if (!YT_ID.test(ytId)) return { ok: false, error: "Não encontrei o vídeo nesse link do YouTube." };
    return {
      ok: true,
      faixa: { url: `https://www.youtube.com/watch?v=${ytId}`, tipo: "youtube", youtube_id: ytId },
      tituloSugerido: "Vídeo do YouTube",
    };
  }

  if (host === "open.spotify.com" || host.endsWith("spotify.com")) {
    return { ok: false, error: "O Spotify não deixa tocar fora do app dele. Use um link do YouTube ou de um arquivo de áudio." };
  }

  let url = u.toString();
  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com") {
    u.searchParams.delete("dl");
    u.searchParams.set("raw", "1");
    url = u.toString();
  } else if (host === "drive.google.com") {
    const m = /\/file\/d\/([^/]+)/.exec(u.pathname);
    const id = m?.[1] ?? u.searchParams.get("id");
    if (!id) return { ok: false, error: "Não encontrei o arquivo nesse link do Google Drive." };
    url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  }

  const file = decodeURIComponent(u.pathname.split("/").pop() || "");
  const nice = file.replace(AUDIO_EXT, "").replace(/[-_]+/g, " ").trim();
  return { ok: true, faixa: { url, tipo: "audio", youtube_id: null }, tituloSugerido: nice || "Áudio" };
}

/** Seconds into the current track, using the server clock. */
export function currentPosition(s: Pick<SomState, "tocando" | "posicao" | "iniciado_em">, serverNowMs: number): number {
  if (!s.tocando) return Math.max(0, s.posicao);
  return Math.max(0, s.posicao + (serverNowMs - new Date(s.iniciado_em).getTime()) / 1000);
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * The same state machine as the som_controlar() SQL function, for the
 * music page outside a table (preview on this device only).
 */
export function applyLocal(prev: SomState | null, canal: Canal, acao: SomAcao, dados: Record<string, unknown> = {}, nowMs = Date.now()): SomState {
  const s: SomState = prev
    ? { ...prev }
    : { canal, faixa: null, fila: [], fila_idx: 0, tocando: false, posicao: 0, iniciado_em: new Date(nowMs).toISOString(), repetir: canal === "ambiente", volume: 1, versao: 0 };
  s.versao = Number(s.versao ?? 0) + 1;
  const pos = currentPosition(s, nowMs);
  const now = new Date(nowMs).toISOString();
  const n = s.fila.length;
  switch (acao) {
    case "tocar": {
      const fila = Array.isArray(dados.fila) ? (dados.fila as Faixa[]) : dados.faixa ? [dados.faixa as Faixa] : [];
      if (!fila.length) return s;
      s.fila = fila;
      s.fila_idx = Math.max(0, Math.min(Number(dados.idx ?? 0) || 0, fila.length - 1));
      s.faixa = fila[s.fila_idx];
      s.tocando = true;
      s.posicao = Math.max(0, Number(dados.posicao ?? 0) || 0);
      s.iniciado_em = now;
      if (typeof dados.repetir === "boolean") s.repetir = dados.repetir;
      break;
    }
    case "pausar":
      Object.assign(s, { posicao: pos, tocando: false, iniciado_em: now });
      break;
    case "continuar":
      if (s.faixa) Object.assign(s, { posicao: pos, tocando: true, iniciado_em: now });
      break;
    case "buscar":
      Object.assign(s, { posicao: Math.max(0, Number(dados.posicao) || 0), iniciado_em: now });
      break;
    case "proxima":
    case "anterior":
      if (!n || !s.faixa) break;
      if (acao === "anterior" && pos > 4) Object.assign(s, { posicao: 0 });
      else if (acao === "proxima" && dados.fim === true && s.fila_idx >= n - 1 && !s.repetir) {
        Object.assign(s, { fila_idx: 0, faixa: s.fila[0], tocando: false, posicao: 0 });
      } else {
        s.fila_idx = (s.fila_idx + (acao === "proxima" ? 1 : -1) + n) % n;
        Object.assign(s, { faixa: s.fila[s.fila_idx], posicao: 0, tocando: true });
      }
      s.iniciado_em = now;
      break;
    case "parar":
      Object.assign(s, { tocando: false, posicao: 0, faixa: null, fila: [], fila_idx: 0, iniciado_em: now });
      break;
    case "repetir":
      Object.assign(s, { repetir: typeof dados.valor === "boolean" ? dados.valor : !s.repetir, posicao: pos, iniciado_em: now });
      break;
    case "volume":
      Object.assign(s, { volume: Math.max(0, Math.min(1, Number(dados.valor ?? 1))), posicao: pos, iniciado_em: now });
      break;
  }
  return s;
}
