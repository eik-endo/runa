"use client";

import { AETTIR } from "@/lib/dice/runes";
import { summarize } from "@/lib/dice/summary";
import type { RollRecord } from "@/lib/dice/types";
import { Icon } from "./glyphs";
import { DiceChips, RuneBadges } from "./ResultBanner";

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function RollEntry({
  record,
  showWho,
  rune,
  onRepeat,
}: {
  record: RollRecord;
  showWho?: boolean;
  rune?: string | null;
  onRepeat?: (r: RollRecord) => void;
}) {
  const outcome = summarize(record.groups, record.modifier);
  const runes = outcome.groups.flatMap((g) => g.dice.filter((d) => d.rune).map((d) => d.rune!));
  const mine = rune ?? record.by.rune;
  const flag = outcome.natural;
  const totalText =
    outcome.total !== null
      ? String(outcome.total)
      : outcome.groups.length === 1 && outcome.groups[0].dice.length === 1 && !outcome.groups[0].dice[0].rune
        ? outcome.groups[0].dice[0].label
        : "";

  return (
    <li className="entry">
      <span className="entry-bar" style={{ background: record.by.color }} />
      <div style={{ minWidth: 0 }}>
        <div className="entry-top">
          {showWho && <b>{record.by.name}</b>}
          <span>{time(record.createdAt)}</span>
          {record.isPrivate && (
            <span className="badge" title="Só você e o mestre veem esta rolagem">
              <Icon name="lock" size={12} /> secreta
            </span>
          )}
        </div>
        <div className="entry-label">
          {record.label ? `${record.label} · ` : ""}
          <span style={{ color: "var(--wool-dim)", fontWeight: 560 }}>{record.notation}</span>
        </div>
        <DiceChips outcome={outcome} modifier={record.modifier} />
        {(flag || runes.length > 0) && (
          <div className="entry-note">
            {flag === "crit" && <span className="badge amber">Crítico</span>}
            {flag === "fumble" && <span className="badge madder">Falha crítica</span>}
            {runes.map((r, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 8 }}>
                {r.meaning} · {AETTIR[r.aett].short}
                <RuneBadges rolled={r} mine={mine} />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="entry-actions">
        <span className={`entry-total${flag ? ` ${flag}` : ""}`}>{totalText}</span>
        {onRepeat && (
          <button type="button" className="icon-btn" onClick={() => onRepeat(record)} aria-label="Rolar de novo" title="Rolar de novo">
            <Icon name="repeat" size={18} />
          </button>
        )}
      </div>
    </li>
  );
}

export function RollLog({
  records,
  showWho,
  runeOf,
  onRepeat,
  title = "Histórico",
  actions,
  emptyText = "As rolagens aparecem aqui.",
}: {
  records: RollRecord[];
  showWho?: boolean;
  runeOf?: (r: RollRecord) => string | null | undefined;
  onRepeat?: (r: RollRecord) => void;
  title?: string;
  actions?: React.ReactNode;
  emptyText?: string;
}) {
  return (
    <section className="panel log" aria-label={title}>
      <div className="log-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {records.length ? (
        <ul className="log-list">
          {records.map((r) => (
            <RollEntry key={r.id} record={r} showWho={showWho} rune={runeOf?.(r)} onRepeat={onRepeat} />
          ))}
        </ul>
      ) : (
        <p className="log-empty">{emptyText}</p>
      )}
    </section>
  );
}
