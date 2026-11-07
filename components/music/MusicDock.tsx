"use client";

import { useEffect, useRef, useState } from "react";
import { type Canal, type SomControl, type SomState, formatTime } from "@/lib/music";
import { useLocalState } from "@/lib/use-local";
import { Icon } from "../glyphs";
import { type ChannelHandle, type ChannelStatus, ChannelPlayer } from "./ChannelPlayer";

const LABEL: Record<Canal, string> = { musica: "Música", ambiente: "Ambiente" };

function Deck({
  canal,
  state,
  skewMs,
  master,
  control,
  localVolume,
  setLocalVolume,
  muted,
}: {
  canal: Canal;
  state: SomState | null;
  skewMs: number;
  master: boolean;
  control?: SomControl;
  localVolume: number;
  setLocalVolume: (v: number) => void;
  muted: boolean;
}) {
  const player = useRef<ChannelHandle>(null);
  const [status, setStatus] = useState<ChannelStatus>({ blocked: false, error: null, duration: null, position: 0 });
  const [seeking, setSeeking] = useState<number | null>(null);
  const f = state?.faixa ?? null;
  const vol = muted ? 0 : localVolume * (state?.volume ?? 1);
  const act = (acao: Parameters<SomControl>[1], dados?: Record<string, unknown>) => void control?.(canal, acao, dados);
  const isYT = f?.tipo === "youtube";
  const size = canal === "musica" ? { width: 176, height: 99 } : { width: 128, height: 72 };

  // the browser blocked autoplay: any click on the page turns the sound on
  useEffect(() => {
    if (!status.blocked) return;
    const unlock = () => player.current?.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [status.blocked]);

  return (
    <div className={`deck${f ? "" : " idle"}`} data-canal={canal}>
      <ChannelPlayer
        ref={player}
        state={state}
        skewMs={skewMs}
        volume={vol}
        controller={master}
        onEnded={() => act("proxima", { fim: true })}
        onStatus={setStatus}
        {...size}
      />
      {f && (
        <div className="deck-info" style={{ minWidth: 0 }}>
          <div className="deck-title">
            <span className={`badge${canal === "ambiente" ? " moss" : " amber"}`}>{LABEL[canal]}</span>
            <span className="deck-name" title={f.titulo}>
              {f.titulo}
            </span>
          </div>
          {state && state.fila.length > 1 && (
            <div className="hint">
              {state.fila_idx + 1} de {state.fila.length}
              {state.repetir ? " · repetindo a lista" : ""}
            </div>
          )}
          {status.error ? (
            <p className="error">{status.error}</p>
          ) : (
            <div className="deck-progress">
              <span className="time">{formatTime(seeking ?? status.position)}</span>
              {master && status.duration ? (
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(status.duration))}
                  step={1}
                  value={Math.floor(seeking ?? status.position)}
                  aria-label={`Posição da ${LABEL[canal].toLowerCase()}`}
                  onChange={(e) => setSeeking(Number(e.target.value))}
                  onPointerUp={() => {
                    if (seeking !== null) act("buscar", { posicao: seeking });
                    setSeeking(null);
                  }}
                  onKeyUp={() => {
                    if (seeking !== null) act("buscar", { posicao: seeking });
                    setSeeking(null);
                  }}
                />
              ) : (
                <span className="bar" aria-hidden="true">
                  <span style={{ width: status.duration ? `${Math.min(100, (status.position / status.duration) * 100)}%` : "0%" }} />
                </span>
              )}
              <span className="time">{status.duration ? formatTime(status.duration) : isYT ? "" : "--:--"}</span>
            </div>
          )}
          <div className="deck-controls">
            {master && (
              <>
                {canal === "musica" && (
                  <button type="button" className="icon-btn" onClick={() => act("anterior")} aria-label="Anterior" title="Anterior">
                    <Icon name="prev" size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => act(state?.tocando ? "pausar" : "continuar")}
                  aria-label={state?.tocando ? "Pausar" : "Tocar"}
                  title={state?.tocando ? "Pausar para todos" : "Tocar para todos"}
                >
                  <Icon name={state?.tocando ? "pause" : "play"} size={16} />
                </button>
                {canal === "musica" && (
                  <button type="button" className="icon-btn" onClick={() => act("proxima")} aria-label="Próxima" title="Próxima">
                    <Icon name="next" size={16} />
                  </button>
                )}
                <button type="button" className="icon-btn" onClick={() => act("parar")} aria-label="Parar" title="Parar para todos">
                  <Icon name="stop" size={16} />
                </button>
                <button
                  type="button"
                  className={`icon-btn${state?.repetir ? " on" : ""}`}
                  aria-pressed={!!state?.repetir}
                  onClick={() => act("repetir")}
                  aria-label="Repetir"
                  title={state && state.fila.length > 1 ? "Repetir a lista" : "Repetir a faixa"}
                >
                  <Icon name="repeat" size={16} />
                </button>
              </>
            )}
            {!master && <span className="hint">{state?.tocando ? "Tocando" : "Pausado pelo mestre"}</span>}
            <label className="vol" title={`Volume da ${LABEL[canal].toLowerCase()} só para você`}>
              <Icon name={vol > 0 ? "sound" : "mute"} size={16} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={localVolume}
                aria-label={`Volume da ${LABEL[canal].toLowerCase()} neste aparelho`}
                onChange={(e) => setLocalVolume(Number(e.target.value))}
              />
            </label>
          </div>
          {status.blocked && state?.tocando && (
            <button type="button" className="btn btn-primary btn-small" onClick={() => player.current?.unlock()}>
              Ativar som
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What is playing at the table, for everyone. Players get their own volume;
 * the game master also gets the transport controls.
 */
export function MusicDock({
  states,
  skewMs,
  master,
  control,
}: {
  states: Partial<Record<Canal, SomState | null>>;
  skewMs: number;
  master: boolean;
  control?: SomControl;
}) {
  const [volMusic, setVolMusic] = useLocalState("runa:vol:musica", 0.8);
  const [volAmb, setVolAmb] = useLocalState("runa:vol:ambiente", 0.6);
  const [muted, setMuted] = useLocalState("runa:som-mudo", false);
  const active = Boolean(states.musica?.faixa || states.ambiente?.faixa);

  return (
    <div className={`music-dock${active ? "" : " empty"}`} aria-label="Som da mesa">
      {active && (
        <div className="dock-head">
          <span className="dock-title">
            <Icon name="music" size={16} /> Som da mesa
          </span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setMuted(!muted)} aria-pressed={muted}>
            {muted ? "Ligar som" : "Silenciar"}
          </button>
        </div>
      )}
      <Deck canal="musica" state={states.musica ?? null} skewMs={skewMs} master={master} control={control} localVolume={volMusic} setLocalVolume={setVolMusic} muted={muted} />
      <Deck canal="ambiente" state={states.ambiente ?? null} skewMs={skewMs} master={master} control={control} localVolume={volAmb} setLocalVolume={setVolAmb} muted={muted} />
    </div>
  );
}
