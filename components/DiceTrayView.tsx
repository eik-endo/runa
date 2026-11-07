"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { DiceTray } from "@/lib/dice/tray";
import { hasPhysicalModel } from "@/lib/dice/models";
import { type FlatDie, prepareThrow } from "@/lib/dice/roll";
import type { RollOutcome } from "@/lib/dice/summary";
import type { RollRecord } from "@/lib/dice/types";
import { useLocalState } from "@/lib/use-local";
import { Icon } from "./glyphs";
import { ResultBanner } from "./ResultBanner";

export interface TrayHandle {
  /** Animates a roll; resolves when the dice have landed. */
  play(record: RollRecord): Promise<void>;
  clear(): void;
  unlockAudio(): void;
}

interface Landed {
  record: RollRecord;
  outcome: RollOutcome;
}

const LABEL_FONT_LOAD = '800 64px "Schibsted Grotesk Variable"';

export const DiceTrayView = forwardRef<TrayHandle, { emptyHint?: string; showWho?: boolean; runeOf?: (r: RollRecord) => string | null | undefined }>(
  function DiceTrayView({ emptyHint, showWho, runeOf }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const tray = useRef<DiceTray | null>(null);
    const ready = useRef<Promise<DiceTray | null> | null>(null);
    const [landed, setLanded] = useState<Landed | null>(null);
    const [flat, setFlat] = useState<{ id: string; dice: FlatDie[]; rolling: boolean; pool: string[][] } | null>(null);
    const [muted, setMuted] = useLocalState("runa:muted", false);
    const [failed, setFailed] = useState(false);
    const [used, setUsed] = useState(false);
    const [, force] = useState(0);
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    useEffect(() => {
      let cancelled = false;
      let instance: DiceTray | null = null;
      ready.current = (async () => {
        try {
          await Promise.race([document.fonts?.load(LABEL_FONT_LOAD), new Promise((r) => setTimeout(r, 1500))]);
        } catch {
          /* fall back to system font */
        }
        try {
          const mod = await import("@/lib/dice/tray");
          if (cancelled || !host.current) return null;
          instance = new mod.DiceTray(host.current);
          instance.muted = mutedRef.current;
          tray.current = instance;
          force((n) => n + 1);
          return instance;
        } catch (e) {
          console.error("Não foi possível iniciar a bandeja 3D", e);
          setFailed(true);
          return null;
        }
      })();
      return () => {
        cancelled = true;
        instance?.dispose();
        tray.current = null;
      };
    }, []);

    useEffect(() => {
      if (tray.current) tray.current.muted = muted;
    }, [muted]);

    const play = useCallback(async (record: RollRecord) => {
      setUsed(true);
      const prepared = prepareThrow(record);
      const t = tray.current ?? (await ready.current);
      const showFlat = () => {
        if (!prepared.flat.length) {
          setFlat(null);
          return;
        }
        const pool = record.groups
          .filter((g) => !hasPhysicalModel(g.die))
          .map((g) => g.die.faces ?? Array.from({ length: Math.min(g.die.sides, 60) }, (_, i) => String(i + 1)));
        setFlat({ id: record.id, dice: prepared.flat, rolling: true, pool });
      };
      const settle = () => {
        setFlat((f) => (f && f.id === record.id ? { ...f, rolling: false } : f));
        setLanded({ record, outcome: prepared.outcome });
      };
      if (t && prepared.tray.dice.length) {
        setLanded((l) => (l ? null : l));
        prepared.tray.onStart = () => {
          setLanded(null);
          showFlat();
        };
        await t.throw(prepared.tray);
        settle();
      } else {
        // Nothing to throw in 3D: tumble the flat dice for a moment.
        t?.clear();
        setLanded(null);
        showFlat();
        await new Promise((r) => setTimeout(r, 900));
        settle();
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        play,
        clear() {
          tray.current?.clear();
          setLanded(null);
          setFlat(null);
        },
        unlockAudio() {
          tray.current?.unlockAudio();
        },
      }),
      [play],
    );

    return (
      <div className="tray">
        <div className="tray-canvas" ref={host} />
        <div className="tray-vignette" />
        {(failed || (!used && !landed && !flat)) && (
          <div className="tray-empty">{failed ? "Seu navegador não conseguiu abrir a bandeja 3D. As rolagens continuam funcionando." : emptyHint}</div>
        )}
        {flat && <FlatDice dice={flat.dice} rolling={flat.rolling} pool={flat.pool} />}
        {landed && <ResultBanner record={landed.record} outcome={landed.outcome} showWho={showWho} rune={runeOf?.(landed.record)} />}
        <div className="tray-tools">
          <button
            className="icon-btn"
            type="button"
            onClick={() => setMuted(!muted)}
            aria-label={muted ? "Ligar som dos dados" : "Desligar som dos dados"}
            title={muted ? "Ligar som" : "Desligar som"}
          >
            <Icon name={muted ? "mute" : "sound"} />
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={() => {
              tray.current?.clear();
              setLanded(null);
              setFlat(null);
            }}
            aria-label="Limpar a bandeja"
            title="Limpar a bandeja"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    );
  },
);

function FlatDice({ dice, rolling, pool }: { dice: FlatDie[]; rolling: boolean; pool: string[][] }) {
  const all = pool.flat();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setTick((t) => t + 1), 70);
    return () => clearInterval(id);
  }, [rolling]);
  return (
    <div className="flat-dice" aria-hidden={rolling}>
      {dice.map((d, i) => {
        const label = rolling && all.length ? all[(tick * 7 + i * 13) % all.length] : d.label;
        return (
          <span
            key={i}
            className={`flat-die${rolling ? " rolling" : ""}${!rolling && d.dropped ? " dropped" : ""}`}
            style={{ background: d.look.base, color: d.look.label }}
          >
            {label.trim() || "·"}
          </span>
        );
      })}
    </div>
  );
}
