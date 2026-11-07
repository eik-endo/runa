"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DieSpec, RollRecord, RollRequest, RolledGroup } from "./dice/types";
import type { Canal, Faixa, SomAcao, SomState } from "./music";
import type { SheetSystem } from "./sheet";
import { supabase } from "./supabase/client";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  dice_color: string;
  is_guest: boolean;
}

export interface Mesa {
  id: string;
  code: string;
  owner_id: string;
  name: string;
  kind: "campanha" | "avulsa";
  system: string;
  description: string;
  rune_system: boolean;
  visibility: "publica" | "privada";
  created_at: string;
  last_roll_at: string | null;
}

export interface MesaSummary extends Mesa {
  owner_name: string;
  role: "mestre" | "jogador";
  character_name: string;
  character_notes: string;
  rune: string | null;
  color: string | null;
  ficha_id: string | null;
  members: number;
}

export interface Member {
  user_id: string;
  role: "mestre" | "jogador";
  character_name: string;
  character_notes: string;
  rune: string | null;
  color: string;
  display_name: string;
  username: string;
  is_guest: boolean;
  joined_at: string;
  ficha_id: string | null;
}

export interface MesaState {
  mesa: Mesa;
  role: "mestre" | "jogador";
  members: Member[];
}

export interface SavedDie {
  id: string;
  owner_id: string;
  mesa_id: string | null;
  name: string;
  spec: DieSpec;
}

interface RollRow {
  id: string;
  mesa_id: string;
  user_id: string | null;
  roller_name: string;
  roller_color: string;
  roller_rune: string | null;
  label: string | null;
  notation: string;
  groups: RolledGroup[];
  modifier: number;
  seed: number;
  is_private: boolean;
  created_at: string;
}

/** Turns Postgres / Supabase errors into a sentence for the interface. */
export function errorMessage(e: unknown): string {
  if (!e) return "Algo deu errado.";
  const err = e as { message?: string; code?: string; details?: string };
  const msg = err.message ?? String(e);
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  if (/JWT|not authenticated|Faça login/i.test(msg)) return "Sua sessão expirou. Entre de novo.";
  if (err.code === "42501" && !/[áéíóúãõç]/i.test(msg)) return "Você não tem permissão para isso.";
  return msg;
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data;
}

export function toRecord(row: RollRow): RollRecord {
  return {
    id: row.id,
    notation: row.notation,
    label: row.label,
    groups: row.groups,
    modifier: row.modifier,
    createdAt: row.created_at,
    by: { id: row.user_id ?? "", name: row.roller_name, color: row.roller_color, rune: row.roller_rune },
    isPrivate: row.is_private,
    seed: row.seed,
  };
}

// ------------------------------------------------------------------ profile

export async function ensureProfile(): Promise<Profile> {
  return check(await supabase().rpc("ensure_profile")) as Profile;
}

export async function updateProfile(id: string, patch: Partial<Pick<Profile, "display_name" | "dice_color">>) {
  check(await supabase().from("profiles").update(patch).eq("id", id));
}

// ------------------------------------------------------------------ mesas

export async function myMesas(): Promise<MesaSummary[]> {
  return (check(await supabase().rpc("my_mesas")) as MesaSummary[]) ?? [];
}

export async function createMesa(input: {
  name: string;
  kind: "campanha" | "avulsa";
  system?: string;
  description?: string;
  runeSystem?: boolean;
  visibility?: "publica" | "privada";
}): Promise<Mesa> {
  return check(
    await supabase().rpc("create_mesa", {
      p_name: input.name,
      p_kind: input.kind,
      p_system: input.system ?? "D&D 5.5",
      p_description: input.description ?? "",
      p_rune_system: input.runeSystem ?? false,
      p_visibility: input.visibility ?? "privada",
    }),
  ) as Mesa;
}

export interface MesaListing {
  id: string;
  name: string;
  kind: "campanha" | "avulsa";
  system: string;
  description: string;
  visibility: "publica" | "privada";
  rune_system: boolean;
  created_at: string;
  last_roll_at: string | null;
  owner_name: string;
  members: number;
  code: string | null;
  my_role: "mestre" | "jogador" | null;
}

export async function browseMesas(query: string, filter: "todas" | "publica" | "privada" | "minhas", offset = 0, limit = 30): Promise<MesaListing[]> {
  return (check(await supabase().rpc("browse_mesas", { p_query: query, p_filter: filter, p_limit: limit, p_offset: offset })) as MesaListing[]) ?? [];
}

export async function joinMesa(code: string): Promise<{ mesa: Mesa; role: "mestre" | "jogador" }> {
  return check(await supabase().rpc("join_mesa", { p_code: code })) as { mesa: Mesa; role: "mestre" | "jogador" };
}

export async function mesaState(mesaId: string): Promise<MesaState> {
  return check(await supabase().rpc("mesa_state", { p_mesa: mesaId })) as MesaState;
}

export async function updateMesa(id: string, patch: Partial<Pick<Mesa, "name" | "system" | "description" | "rune_system" | "visibility">>) {
  check(await supabase().from("mesas").update(patch).eq("id", id));
}

export async function deleteMesa(id: string) {
  check(await supabase().from("mesas").delete().eq("id", id));
}

export async function regenerateCode(id: string): Promise<string> {
  return check(await supabase().rpc("regenerate_code", { p_mesa: id })) as string;
}

export async function updateMyMember(
  mesaId: string,
  userId: string,
  patch: Partial<Pick<Member, "character_name" | "character_notes" | "rune" | "color" | "ficha_id">>,
) {
  check(await supabase().from("mesa_members").update(patch).eq("mesa_id", mesaId).eq("user_id", userId));
}

export async function removeMember(mesaId: string, userId: string) {
  check(await supabase().from("mesa_members").delete().eq("mesa_id", mesaId).eq("user_id", userId));
}

// ------------------------------------------------------------------ rolls

export async function recentRolls(mesaId: string, limit = 60): Promise<RollRecord[]> {
  const rows = check(
    await supabase().from("rolls").select("*").eq("mesa_id", mesaId).order("created_at", { ascending: false }).limit(limit),
  ) as RollRow[];
  return rows.map(toRecord);
}

export async function rollAtMesa(mesaId: string, req: RollRequest, isPrivate: boolean): Promise<RollRecord> {
  const groups = req.groups.map((g) => ({
    sign: g.sign,
    count: g.count,
    die: { type: g.die.type, sides: g.die.sides, ...(g.die.faces ? { faces: g.die.faces } : {}), ...(g.die.name ? { name: g.die.name } : {}) },
    ...(g.keep ? { keep: g.keep } : {}),
  }));
  const row = check(
    await supabase().rpc("roll_dice", {
      p_mesa: mesaId,
      p_groups: groups,
      p_modifier: req.modifier,
      p_notation: req.notation,
      p_label: req.label ?? null,
      p_private: isPrivate,
    }),
  ) as RollRow;
  return toRecord(row);
}

export async function clearRolls(mesaId: string) {
  check(await supabase().from("rolls").delete().eq("mesa_id", mesaId));
}

// ------------------------------------------------------------------ custom dice

function toSaved(row: { id: string; owner_id: string; mesa_id: string | null; name: string; spec: DieSpec }): SavedDie {
  return { ...row, spec: { ...row.spec, id: row.id, name: row.name } };
}

export async function listCustomDice(): Promise<SavedDie[]> {
  const rows = check(await supabase().from("custom_dice").select("id, owner_id, mesa_id, name, spec").order("created_at")) as SavedDie[];
  return rows.map(toSaved);
}

export async function createCustomDie(name: string, spec: DieSpec, mesaId: string | null): Promise<SavedDie> {
  const clean: DieSpec = { type: spec.type, sides: spec.sides, ...(spec.faces ? { faces: spec.faces } : {}) };
  const row = check(
    await supabase().from("custom_dice").insert({ name, spec: clean, mesa_id: mesaId }).select("id, owner_id, mesa_id, name, spec").single(),
  ) as SavedDie;
  return toSaved(row);
}

export async function deleteCustomDie(id: string) {
  check(await supabase().from("custom_dice").delete().eq("id", id));
}

// ------------------------------------------------------------------ realtime

export interface PresenceUser {
  user_id: string;
  name: string;
  color: string;
}

export interface MesaHandlers {
  onRoll(record: RollRecord): void;
  onMembersChanged(): void;
  onDiceChanged(): void;
  onPresence(users: PresenceUser[]): void;
  onSound?(state: SomState): void;
  onCombatChanged?(): void;
  onStatus?(status: "online" | "offline"): void;
}

/** Live updates of a table: new rolls, member changes and who is online. */
export function subscribeMesa(mesaId: string, me: PresenceUser, h: MesaHandlers): { unsubscribe(): void; updatePresence(p: PresenceUser): void } {
  const sb = supabase();
  let channel: RealtimeChannel | null = null;
  let current = me;
  channel = sb
    .channel(`mesa:${mesaId}`, { config: { presence: { key: me.user_id } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "rolls", filter: `mesa_id=eq.${mesaId}` }, (payload) => {
      h.onRoll(toRecord(payload.new as RollRow));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "mesa_members", filter: `mesa_id=eq.${mesaId}` }, () => h.onMembersChanged())
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_dice", filter: `mesa_id=eq.${mesaId}` }, () => h.onDiceChanged())
    .on("postgres_changes", { event: "*", schema: "public", table: "mesa_som", filter: `mesa_id=eq.${mesaId}` }, (payload) => {
      if (payload.eventType !== "DELETE") h.onSound?.(payload.new as SomState);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "mesa_combate", filter: `mesa_id=eq.${mesaId}` }, () => h.onCombatChanged?.())
    .on("presence", { event: "sync" }, () => {
      const state = channel!.presenceState<PresenceUser>();
      const users = Object.values(state)
        .map((list) => list[list.length - 1])
        .filter(Boolean);
      h.onPresence(users);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        h.onStatus?.("online");
        void channel!.track(current);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        h.onStatus?.("offline");
      }
    });
  return {
    unsubscribe() {
      if (channel) void sb.removeChannel(channel);
      channel = null;
    },
    updatePresence(p) {
      current = p;
      void channel?.track(p);
    },
  };
}

// ------------------------------------------------------------------ server clock

/** Milliseconds to add to Date.now() to get the server's clock. */
export async function measureClockSkew(): Promise<number> {
  const t0 = Date.now();
  const server = check(await supabase().rpc("server_time")) as string;
  const t1 = Date.now();
  return new Date(server).getTime() - (t0 + t1) / 2;
}

// ------------------------------------------------------------------ sheets

export interface Ficha {
  id: string;
  owner_id: string;
  name: string;
  system: SheetSystem;
  data: unknown;
  attachment_path: string | null;
  attachment_kind: "pdf" | "image" | null;
  attachment_name: string | null;
  created_at: string;
  updated_at: string;
}

const FICHA_COLS = "id, owner_id, name, system, data, attachment_path, attachment_kind, attachment_name, created_at, updated_at";

export async function myFichas(ownerId: string): Promise<Ficha[]> {
  return check(await supabase().from("fichas").select(FICHA_COLS).eq("owner_id", ownerId).order("updated_at", { ascending: false })) as Ficha[];
}

export async function getFicha(id: string): Promise<Ficha | null> {
  const rows = check(await supabase().from("fichas").select(FICHA_COLS).eq("id", id).limit(1)) as Ficha[];
  return rows[0] ?? null;
}

export async function createFicha(name: string, system: SheetSystem, data: unknown): Promise<Ficha> {
  return check(await supabase().from("fichas").insert({ name, system, data }).select(FICHA_COLS).single()) as Ficha;
}

export async function saveFicha(id: string, patch: Partial<Pick<Ficha, "name" | "data" | "attachment_path" | "attachment_kind" | "attachment_name">>): Promise<string> {
  const row = check(await supabase().from("fichas").update(patch).eq("id", id).select("updated_at").single()) as { updated_at: string };
  return row.updated_at;
}

export async function deleteFicha(f: Ficha) {
  if (f.attachment_path) await supabase().storage.from("fichas").remove([f.attachment_path]);
  check(await supabase().from("fichas").delete().eq("id", f.id));
}

export async function uploadFichaFile(ownerId: string, fichaId: string, file: File): Promise<{ path: string; kind: "pdf" | "image" }> {
  const kind = file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "image" : null;
  if (!kind) throw new Error("Envie um PDF ou uma imagem (PNG, JPG ou WEBP).");
  if (file.size > 10 * 1024 * 1024) throw new Error("O arquivo pode ter no máximo 10 MB.");
  const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "ficha";
  const path = `${ownerId}/${fichaId}/${Date.now()}-${safe}`;
  const { error } = await supabase().storage.from("fichas").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(/bucket/i.test(error.message) ? "O envio de arquivos ainda não está ligado neste site." : errorMessage(error));
  return { path, kind };
}

export async function removeFichaFile(path: string) {
  await supabase().storage.from("fichas").remove([path]);
}

export async function fichaFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase().storage.from("fichas").createSignedUrl(path, 60 * 60);
  if (error || !data) throw new Error("Não foi possível abrir o arquivo da ficha.");
  return data.signedUrl;
}

export function subscribeFicha(id: string, onChange: (f: Ficha) => void): () => void {
  const sb = supabase();
  const ch = sb
    .channel(`ficha:${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "fichas", filter: `id=eq.${id}` }, (p) => onChange(p.new as Ficha))
    .subscribe();
  return () => void sb.removeChannel(ch);
}

// ------------------------------------------------------------------ music library

export interface Musica extends Faixa {
  id: string;
  owner_id: string;
  created_at: string;
}

export interface Playlist {
  id: string;
  owner_id: string;
  nome: string;
  posicao: number;
  created_at: string;
}

export interface PlaylistItem {
  playlist_id: string;
  musica_id: string;
  posicao: number;
}

export async function myMusic(ownerId: string): Promise<{ musicas: Musica[]; playlists: Playlist[]; itens: PlaylistItem[] }> {
  const sb = supabase();
  const [m, p] = await Promise.all([
    sb.from("musicas").select("id, owner_id, titulo, url, tipo, youtube_id, created_at").eq("owner_id", ownerId).order("created_at", { ascending: false }),
    sb.from("playlists").select("id, owner_id, nome, posicao, created_at").eq("owner_id", ownerId).order("posicao").order("created_at"),
  ]);
  const musicas = check(m) as Musica[];
  const playlists = check(p) as Playlist[];
  const itens = playlists.length
    ? (check(await sb.from("playlist_musicas").select("playlist_id, musica_id, posicao").order("posicao")) as PlaylistItem[])
    : [];
  return { musicas, playlists, itens };
}

export async function addMusica(f: Faixa): Promise<Musica> {
  return check(
    await supabase()
      .from("musicas")
      .insert({ titulo: f.titulo, url: f.url, tipo: f.tipo, youtube_id: f.youtube_id ?? null })
      .select("id, owner_id, titulo, url, tipo, youtube_id, created_at")
      .single(),
  ) as Musica;
}

export async function renameMusica(id: string, titulo: string) {
  check(await supabase().from("musicas").update({ titulo }).eq("id", id));
}

export async function deleteMusica(id: string) {
  check(await supabase().from("musicas").delete().eq("id", id));
}

export async function createPlaylist(nome: string, posicao: number): Promise<Playlist> {
  return check(await supabase().from("playlists").insert({ nome, posicao }).select("id, owner_id, nome, posicao, created_at").single()) as Playlist;
}

export async function renamePlaylist(id: string, nome: string) {
  check(await supabase().from("playlists").update({ nome }).eq("id", id));
}

export async function deletePlaylist(id: string) {
  check(await supabase().from("playlists").delete().eq("id", id));
}

export async function addToPlaylist(playlistId: string, musicaId: string, posicao: number) {
  check(await supabase().from("playlist_musicas").insert({ playlist_id: playlistId, musica_id: musicaId, posicao }));
}

export async function removeFromPlaylist(playlistId: string, musicaId: string) {
  check(await supabase().from("playlist_musicas").delete().eq("playlist_id", playlistId).eq("musica_id", musicaId));
}

export async function reorderPlaylist(playlistId: string, musicaIds: string[]) {
  check(await supabase().rpc("playlist_reordenar", { p_playlist: playlistId, p_musicas: musicaIds }));
}

// ------------------------------------------------------------------ table sound

export async function mesaSound(mesaId: string): Promise<SomState[]> {
  return check(await supabase().from("mesa_som").select("*").eq("mesa_id", mesaId)) as SomState[];
}

export async function controlSound(mesaId: string, canal: Canal, acao: SomAcao, dados: Record<string, unknown> = {}): Promise<SomState> {
  return check(await supabase().rpc("som_controlar", { p_mesa: mesaId, p_canal: canal, p_acao: acao, p_dados: dados })) as SomState;
}

// ------------------------------------------------------------------ initiative

export interface Combatente {
  id: string;
  user_id: string | null;
  nome: string;
  iniciativa: number;
  desempate: number;
  cor: string | null;
  oculto: boolean;
  pv: number | null;
  pv_max: number | null;
  ca: number | null;
  estado: "ileso" | "ferido" | "muito ferido" | "caido" | null;
}

export interface Combate {
  ativo: boolean;
  rodada: number;
  turno: string | null;
  versao: number;
  combatentes: Combatente[];
}

export async function combatState(mesaId: string): Promise<Combate> {
  return check(await supabase().rpc("iniciativa_estado", { p_mesa: mesaId })) as Combate;
}

export async function joinInitiative(mesaId: string, valor: number, desempate: number): Promise<Combate> {
  return check(await supabase().rpc("iniciativa_entrar", { p_mesa: mesaId, p_valor: valor, p_desempate: desempate })) as Combate;
}

export async function controlCombat(mesaId: string, acao: "iniciar" | "encerrar" | "proximo" | "anterior" | "limpar"): Promise<Combate> {
  return check(await supabase().rpc("combate_controlar", { p_mesa: mesaId, p_acao: acao })) as Combate;
}

export async function addCombatant(mesaId: string, c: { nome: string; iniciativa: number; desempate?: number; pv?: number | null; pv_max?: number | null; ca?: number | null; cor?: string | null; oculto?: boolean; user_id?: string | null }) {
  check(await supabase().from("combatentes").insert({ mesa_id: mesaId, desempate: 0, ...c }));
}

export async function updateCombatant(id: string, patch: Partial<Pick<Combatente, "nome" | "iniciativa" | "pv" | "pv_max" | "ca" | "oculto">>) {
  check(await supabase().from("combatentes").update(patch).eq("id", id));
}

export async function removeCombatant(id: string) {
  check(await supabase().from("combatentes").delete().eq("id", id));
}

// ------------------------------------------------------------------ master notes

export async function loadNotes(mesaId: string): Promise<string> {
  const rows = check(await supabase().from("mesa_notas").select("texto").eq("mesa_id", mesaId).limit(1)) as { texto: string }[];
  return rows[0]?.texto ?? "";
}

export async function saveNotes(mesaId: string, texto: string) {
  check(await supabase().rpc("notas_salvar", { p_mesa: mesaId, p_texto: texto }));
}
