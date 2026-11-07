"use client";

import { AETTIR, RUNE_BY_KEY, type Rune } from "@/lib/dice/runes";
import type { DieOutcome, RollOutcome } from "@/lib/dice/summary";
import type { RollRecord } from "@/lib/dice/types";
import { RuneGlyph } from "./glyphs";

export function runeMatch(rolled: Rune, mine?: string | null): "rune" | "aett" | null {
  if (!mine) return null;
  const own = RUNE_BY_KEY[mine];
  if (!own) return null;
  if (own.key === rolled.key) return "rune";
  if (own.aett === rolled.aett) return "aett";
  return null;
}

export function RuneBadges({ rolled, mine }: { rolled: Rune; mine?: string | null }) {
  const m = runeMatch(rolled, mine);
  if (m === "rune") return <span className="badge amber">Runa do personagem</span>;
  if (m === "aett") return <span className="badge moss">Ætt do personagem</span>;
  return null;
}

export function DiceChips({ outcome, modifier, small }: { outcome: RollOutcome; modifier: number; small?: boolean }) {
  const parts: React.ReactNode[] = [];
  outcome.groups.forEach((g, gi) => {
    if (gi > 0 || g.group.sign < 0) parts.push(<span key={`s${gi}`} className="chip-sep">{g.group.sign < 0 ? "−" : "+"}</span>);
    g.dice.forEach((d, di) => parts.push(<DieChip key={`${gi}-${di}`} d={d} small={small} />));
  });
  if (modifier) parts.push(<span key="mod" className="chip-sep">{modifier > 0 ? `+ ${modifier}` : `− ${-modifier}`}</span>);
  return <span className="entry-dice">{parts}</span>;
}

function DieChip({ d }: { d: DieOutcome; small?: boolean }) {
  const cls = ["chip", d.rune ? "rune" : "", !d.kept ? "dropped" : "", d.kept && d.edge ? d.edge : ""].filter(Boolean).join(" ");
  if (d.rune)
    return (
      <span className={cls} title={`${d.rune.name} — ${d.rune.meaning}`}>
        <RuneGlyph rune={d.rune} size={15} weight={12} />
        {d.rune.name}
      </span>
    );
  return <span className={cls}>{d.label.trim() || "·"}</span>;
}

export function ResultBanner({ record, outcome, showWho, rune }: { record: RollRecord; outcome: RollOutcome; showWho?: boolean; rune?: string | null }) {
  const runes = outcome.groups.flatMap((g) => g.dice.filter((d) => d.rune).map((d) => d.rune!));
  const single = outcome.groups.length === 1 && outcome.groups[0].dice.length === 1 ? outcome.groups[0].dice[0] : null;
  const flag = outcome.natural === "crit" ? "Crítico!" : outcome.natural === "fumble" ? "Falha crítica" : null;
  const mine = rune ?? record.by.rune;

  let big: React.ReactNode;
  if (outcome.total !== null) big = <div className="result-total">{outcome.total}</div>;
  else if (single?.rune)
    big = (
      <div className="result-total result-rune">
        <RuneGlyph rune={single.rune} size={46} weight={10} />
      </div>
    );
  else if (single) big = <div className="result-total" style={{ fontSize: single.label.length > 4 ? "1.6rem" : undefined }}>{single.label.trim() || "·"}</div>;
  else big = null;

  return (
    <div
      className={`result${outcome.natural === "crit" ? " crit" : ""}${outcome.natural === "fumble" ? " fumble" : ""}`}
      role="status"
      aria-live="polite"
    >
      {big}
      <div className="result-meta">
        {showWho && (
          <div className="result-who">
            <span className="dot" style={{ background: record.by.color }} />
            {record.by.name}
            {record.isPrivate && <span className="badge">Secreta</span>}
          </div>
        )}
        <div className="result-line">
          {record.label ? <b>{record.label} </b> : null}
          <span style={{ color: "var(--wool-dim)" }}>{record.notation}</span>
        </div>
        {single?.rune ? (
          <div className="result-line">
            <b>{single.rune.name}</b> <span style={{ color: "var(--wool-dim)" }}>· {AETTIR[single.rune.aett].name}</span>
          </div>
        ) : (
          <DiceChips outcome={outcome} modifier={record.modifier} small />
        )}
        {(flag || runes.length > 0) && (
          <div className="row" style={{ gap: 6 }}>
            {flag && <span className="result-flag">{flag}</span>}
            {runes.length === 1 && <RuneBadges rolled={runes[0]} mine={mine} />}
          </div>
        )}
        {single?.rune && <div className="hint">{single.rune.meaning}</div>}
      </div>
    </div>
  );
}
