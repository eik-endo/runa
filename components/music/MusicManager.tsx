"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Musica,
  type Playlist,
  type PlaylistItem,
  addMusica,
  addToPlaylist,
  createPlaylist,
  deleteMusica,
  deletePlaylist,
  errorMessage,
  myMusic,
  removeFromPlaylist,
  renameMusica,
  renamePlaylist,
  reorderPlaylist,
} from "@/lib/api";
import { type Canal, type Faixa, type SomControl, type SomState, parseMusicLink } from "@/lib/music";
import { Icon } from "../glyphs";
import { toast } from "../Toaster";

const faixaOf = (m: Musica): Faixa => ({ titulo: m.titulo, url: m.url, tipo: m.tipo, youtube_id: m.youtube_id ?? null });

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function youtubeTitle(id: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/oembed?v=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const d = (await r.json()) as { title?: string };
    return d.title?.trim() || null;
  } catch {
    return null;
  }
}

function InlineName({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const done = () => {
    const v = text.trim();
    onSave(v && v !== value ? v : value);
  };
  return (
    <input
      ref={ref}
      className="input inline-name"
      value={text}
      aria-label={label}
      maxLength={120}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") onSave(value);
      }}
    />
  );
}

/**
 * The game master's music library and playlists. Play buttons send the
 * track to the table (or to this device on the music page).
 */
export function MusicManager({
  ownerId,
  control,
  playing,
}: {
  ownerId: string;
  control: SomControl;
  playing: Partial<Record<Canal, SomState | null>>;
}) {
  const [musicas, setMusicas] = useState<Musica[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [itens, setItens] = useState<PlaylistItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"playlists" | "biblioteca">("playlists");
  const [sel, setSel] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const [renamingList, setRenamingList] = useState(false);
  const drag = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await myMusic(ownerId);
      setMusicas(d.musicas);
      setPlaylists(d.playlists);
      setItens(d.itens);
      setSel((s) => (s && d.playlists.some((p) => p.id === s) ? s : d.playlists[0]?.id ?? null));
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, [ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map(musicas.map((m) => [m.id, m])), [musicas]);
  const tracksOf = useCallback(
    (pid: string) =>
      itens
        .filter((i) => i.playlist_id === pid)
        .sort((a, b) => a.posicao - b.posicao)
        .map((i) => byId.get(i.musica_id))
        .filter((m): m is Musica => Boolean(m)),
    [itens, byId],
  );
  const current = sel ? playlists.find((p) => p.id === sel) ?? null : null;
  const currentTracks = current ? tracksOf(current.id) : [];
  const nowUrl = { musica: playing.musica?.faixa?.url, ambiente: playing.ambiente?.faixa?.url };

  const play = (canal: Canal, dados: Record<string, unknown>) =>
    control(canal, "tocar", dados).catch((e: unknown) => toast(errorMessage(e)));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const parsed = parseMusicLink(link);
    if (!parsed.ok) {
      setAddError(parsed.error);
      return;
    }
    setAdding(true);
    try {
      let titulo = parsed.tituloSugerido;
      if (parsed.faixa.tipo === "youtube" && parsed.faixa.youtube_id) titulo = (await youtubeTitle(parsed.faixa.youtube_id)) ?? titulo;
      const m = await addMusica({ ...parsed.faixa, titulo: titulo.slice(0, 120) });
      setMusicas((list) => [m, ...list]);
      if (tab === "playlists" && current) {
        const pos = currentTracks.length + 1;
        await addToPlaylist(current.id, m.id, pos);
        setItens((list) => [...list, { playlist_id: current.id, musica_id: m.id, posicao: pos }]);
      }
      setLink("");
      toast(`Adicionada: ${m.titulo}`);
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const addTo = async (pid: string, m: Musica) => {
    if (itens.some((i) => i.playlist_id === pid && i.musica_id === m.id)) {
      toast("Essa música já está nessa playlist.");
      return;
    }
    const pos = tracksOf(pid).length + 1;
    try {
      await addToPlaylist(pid, m.id, pos);
      setItens((list) => [...list, { playlist_id: pid, musica_id: m.id, posicao: pos }]);
      toast(`${m.titulo} → ${playlists.find((p) => p.id === pid)?.nome}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const move = async (from: number, to: number) => {
    if (!current || from === to || to < 0 || to >= currentTracks.length) return;
    const order = [...currentTracks];
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    const ids = order.map((m) => m.id);
    setItens((list) =>
      list.map((i) => (i.playlist_id === current.id ? { ...i, posicao: ids.indexOf(i.musica_id) + 1 } : i)),
    );
    try {
      await reorderPlaylist(current.id, ids);
    } catch (e) {
      toast(errorMessage(e));
      void load();
    }
  };

  const createList = async () => {
    const nome = (newList ?? "").trim();
    if (!nome) {
      setNewList(null);
      return;
    }
    try {
      const p = await createPlaylist(nome.slice(0, 60), playlists.length + 1);
      setPlaylists((list) => [...list, p]);
      setSel(p.id);
      setNewList(null);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const shown = musicas.filter((m) => !filter.trim() || m.titulo.toLowerCase().includes(filter.trim().toLowerCase()));

  const row = (m: Musica, opts: { index?: number; inPlaylist?: boolean }) => {
    const now = nowUrl.musica === m.url ? "musica" : nowUrl.ambiente === m.url ? "ambiente" : null;
    return (
      <li
        key={m.id}
        className={`track${now ? " now" : ""}${opts.inPlaylist && dragOver === opts.index ? " drag-over" : ""}`}
        draggable={opts.inPlaylist}
        onDragStart={(e) => {
          drag.current = opts.index ?? null;
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!opts.inPlaylist || drag.current === null) return;
          e.preventDefault();
          setDragOver(opts.index ?? null);
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          const from = drag.current;
          drag.current = null;
          setDragOver(null);
          if (from !== null && opts.index !== undefined) void move(from, opts.index);
        }}
        onDragEnd={() => {
          drag.current = null;
          setDragOver(null);
        }}
      >
        {opts.inPlaylist && (
          <span className="grip" title="Arraste para mudar a ordem" aria-hidden="true">
            <Icon name="grip" size={16} />
          </span>
        )}
        <button
          type="button"
          className="icon-btn play-btn"
          title={opts.inPlaylist ? "Tocar a playlist a partir daqui" : "Tocar como música"}
          aria-label={`Tocar ${m.titulo}`}
          onClick={() =>
            opts.inPlaylist && current
              ? void play("musica", { fila: currentTracks.map(faixaOf), idx: opts.index ?? 0 })
              : void play("musica", { faixa: faixaOf(m) })
          }
        >
          <Icon name="play" size={16} />
        </button>
        <div className="track-main">
          {renaming === m.id ? (
            <InlineName
              value={m.titulo}
              label="Nome da música"
              onSave={async (v) => {
                setRenaming(null);
                if (v === m.titulo) return;
                setMusicas((list) => list.map((x) => (x.id === m.id ? { ...x, titulo: v } : x)));
                await renameMusica(m.id, v).catch((e) => toast(errorMessage(e)));
              }}
            />
          ) : (
            <button type="button" className="track-title" title="Clique para renomear" onClick={() => setRenaming(m.id)}>
              {m.titulo}
            </button>
          )}
          <span className="track-sub">
            {m.tipo === "youtube" ? "YouTube" : "Áudio"}
            {now && <span className="badge amber">{now === "musica" ? "tocando" : "no ambiente"}</span>}
          </span>
        </div>
        <div className="track-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            title="Tocar em loop no canal de ambiente (junto com a música)"
            onClick={() => void play("ambiente", { faixa: faixaOf(m), repetir: true })}
          >
            Ambiente
          </button>
          {opts.inPlaylist ? (
            <>
              <button type="button" className="icon-btn" aria-label="Subir" title="Subir" onClick={() => void move(opts.index!, opts.index! - 1)}>
                <Icon name="up" size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label="Descer" title="Descer" onClick={() => void move(opts.index!, opts.index! + 1)}>
                <Icon name="down" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Tirar ${m.titulo} da playlist`}
                title="Tirar da playlist"
                onClick={async () => {
                  if (!current) return;
                  setItens((list) => list.filter((i) => !(i.playlist_id === current.id && i.musica_id === m.id)));
                  await removeFromPlaylist(current.id, m.id).catch((e) => toast(errorMessage(e)));
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </>
          ) : (
            <>
              {playlists.length > 0 && (
                <select
                  className="select add-to"
                  value=""
                  aria-label={`Pôr ${m.titulo} numa playlist`}
                  title="Pôr numa playlist"
                  onChange={(e) => {
                    const pid = e.target.value;
                    e.target.value = "";
                    if (pid) void addTo(pid, m);
                  }}
                >
                  <option value="">+ Playlist</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Apagar ${m.titulo}`}
                title="Apagar da biblioteca"
                onClick={async () => {
                  if (!confirm(`Apagar "${m.titulo}" da biblioteca? Ela sai de todas as playlists.`)) return;
                  setMusicas((list) => list.filter((x) => x.id !== m.id));
                  setItens((list) => list.filter((i) => i.musica_id !== m.id));
                  await deleteMusica(m.id).catch((e) => toast(errorMessage(e)));
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="music-manager">
      <form className="add-track" onSubmit={add}>
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Cole um link do YouTube ou de um arquivo de áudio"
          aria-label="Link da música"
        />
        <button className="btn btn-primary" type="submit" disabled={adding || !link.trim()}>
          {adding ? "Adicionando…" : "Adicionar"}
        </button>
      </form>
      {addError && (
        <p className="error" role="alert">
          {addError}
        </p>
      )}
      <p className="hint">
        {tab === "playlists" && current ? `Músicas novas entram na biblioteca e em “${current.nome}”.` : "Músicas novas entram na biblioteca."} Links do Dropbox e
        do Google Drive também funcionam.
      </p>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "playlists"} onClick={() => setTab("playlists")}>
          Playlists ({playlists.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === "biblioteca"} onClick={() => setTab("biblioteca")}>
          Biblioteca ({musicas.length})
        </button>
      </div>

      {!loaded ? (
        <p className="loading">Carregando músicas…</p>
      ) : tab === "playlists" ? (
        <div className="playlists">
          <div className="playlist-bar">
            {renamingList && current ? (
              <InlineName
                value={current.nome}
                label="Nome da playlist"
                onSave={async (v) => {
                  setRenamingList(false);
                  if (v === current.nome) return;
                  setPlaylists((list) => list.map((p) => (p.id === current.id ? { ...p, nome: v.slice(0, 60) } : p)));
                  await renamePlaylist(current.id, v.slice(0, 60)).catch((e) => toast(errorMessage(e)));
                }}
              />
            ) : (
              <select className="select" value={sel ?? ""} onChange={(e) => setSel(e.target.value || null)} aria-label="Playlist" disabled={!playlists.length}>
                {!playlists.length && <option value="">Nenhuma playlist</option>}
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} ({tracksOf(p.id).length})
                  </option>
                ))}
              </select>
            )}
            {newList === null ? (
              <button type="button" className="btn btn-small" onClick={() => setNewList("")}>
                <Icon name="plus" size={16} /> Nova
              </button>
            ) : (
              <form
                className="row"
                style={{ gap: 6, flexWrap: "nowrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void createList();
                }}
              >
                <input
                  className="input"
                  autoFocus
                  value={newList}
                  maxLength={60}
                  placeholder="Combate, Taverna, Chefe…"
                  aria-label="Nome da nova playlist"
                  onChange={(e) => setNewList(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNewList(null)}
                />
                <button className="btn btn-primary btn-small" type="submit">
                  Criar
                </button>
              </form>
            )}
          </div>
          {current && (
            <>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={!currentTracks.length}
                  onClick={() => void play("musica", { fila: currentTracks.map(faixaOf), idx: 0 })}
                >
                  <Icon name="play" size={14} /> Tocar playlist
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={currentTracks.length < 2}
                  onClick={() => void play("musica", { fila: shuffle(currentTracks).map(faixaOf), idx: 0 })}
                >
                  <Icon name="shuffle" size={14} /> Aleatório
                </button>
                <span className="spacer" />
                <button type="button" className="icon-btn" title="Renomear playlist" aria-label="Renomear playlist" onClick={() => setRenamingList(true)}>
                  <Icon name="edit" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Apagar playlist"
                  aria-label="Apagar playlist"
                  onClick={async () => {
                    if (!confirm(`Apagar a playlist "${current.nome}"? As músicas continuam na biblioteca.`)) return;
                    const id = current.id;
                    setPlaylists((list) => list.filter((p) => p.id !== id));
                    setItens((list) => list.filter((i) => i.playlist_id !== id));
                    setSel(playlists.find((p) => p.id !== id)?.id ?? null);
                    await deletePlaylist(id).catch((e) => toast(errorMessage(e)));
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              {currentTracks.length ? (
                <ol className="track-list">{currentTracks.map((m, i) => row(m, { index: i, inPlaylist: true }))}</ol>
              ) : (
                <div className="empty">Playlist vazia. Cole um link acima ou use “+ Playlist” na Biblioteca.</div>
              )}
            </>
          )}
          {!playlists.length && <div className="empty">Crie playlists por clima de cena: Combate, Taverna, Exploração, Chefe…</div>}
        </div>
      ) : (
        <div className="library">
          <label className="search">
            <Icon name="search" size={16} />
            <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Procurar na biblioteca" aria-label="Procurar música" />
          </label>
          {shown.length ? (
            <ul className="track-list">{shown.map((m) => row(m, {}))}</ul>
          ) : (
            <div className="empty">{musicas.length ? "Nenhuma música com esse nome." : "Sua biblioteca está vazia. Cole um link acima."}</div>
          )}
        </div>
      )}
    </div>
  );
}
