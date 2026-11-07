import { type Rune, runeAt } from "./runes";
import type { DieSpec, RolledGroup } from "./types";

export interface DieOutcome {
  label: string;
  numeric: number | null;
  kept: boolean;
  rune?: Rune;
  /** Highest / lowest face of a numeric standard die. */
  edge?: "max" | "min";
}

export interface GroupOutcome {
  group: RolledGroup;
  dice: DieOutcome[];
  subtotal: number | null;
}

export interface RollOutcome {
  groups: GroupOutcome[];
  total: number | null;
  /** Natural 20 / natural 1 on a single kept d20. */
  natural?: "crit" | "fumble";
}

/** Reads a face label as a number: "+" is 1, "−" is -1, blank is 0. */
export function faceNumber(label: string): number | null {
  const t = label.trim().replace(/−/g, "-");
  if (t === "") return 0;
  if (t === "+") return 1;
  if (t === "-") return -1;
  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

export function isNumericDie(die: DieSpec): boolean {
  if (die.type === "std" || die.type === "pct") return true;
  if (die.type === "rune") return false;
  return (die.faces ?? []).every((f) => faceNumber(f) !== null);
}

export function outcomeLabel(die: DieSpec, value: number): string {
  switch (die.type) {
    case "std":
    case "pct":
      return String(value);
    case "rune":
      return runeAt(value).name;
    case "faces":
      return die.faces?.[value - 1] ?? String(value);
  }
}

export function summarize(groups: RolledGroup[], modifier: number): RollOutcome {
  let total = 0;
  let anyNumeric = false;
  const out: GroupOutcome[] = groups.map((g) => {
    const numericDie = isNumericDie(g.die);
    const dice: DieOutcome[] = g.values.map((v) => {
      const label = outcomeLabel(g.die, v);
      const numeric = numericDie ? (g.die.type === "faces" ? faceNumber(label) : v) : null;
      const d: DieOutcome = { label, numeric, kept: true };
      if (g.die.type === "rune") d.rune = runeAt(v);
      if (g.die.type === "std" || g.die.type === "pct") {
        if (v === g.die.sides) d.edge = "max";
        else if (v === 1) d.edge = "min";
      }
      return d;
    });
    if (g.keep && numericDie) {
      const order = dice.map((d, i) => i).sort((a, b) => (dice[a].numeric ?? 0) - (dice[b].numeric ?? 0) || a - b);
      const n = Math.min(g.keep.n, dice.length);
      let keepIdx: number[];
      switch (g.keep.mode) {
        case "kh":
          keepIdx = order.slice(order.length - n);
          break;
        case "kl":
          keepIdx = order.slice(0, n);
          break;
        case "dh":
          keepIdx = order.slice(0, order.length - n);
          break;
        case "dl":
          keepIdx = order.slice(n);
          break;
      }
      const keepSet = new Set(keepIdx);
      dice.forEach((d, i) => (d.kept = keepSet.has(i)));
    }
    let subtotal: number | null = null;
    if (numericDie) {
      subtotal = dice.reduce((s, d) => s + (d.kept ? (d.numeric ?? 0) : 0), 0);
      total += g.sign * subtotal;
      anyNumeric = true;
    }
    return { group: g, dice, subtotal };
  });

  let natural: RollOutcome["natural"];
  const d20s = out.filter((g) => g.group.die.type === "std" && g.group.die.sides === 20);
  if (d20s.length === 1 && out.length === 1) {
    const kept = d20s[0].dice.filter((d) => d.kept);
    if (kept.length === 1) {
      if (kept[0].numeric === 20) natural = "crit";
      else if (kept[0].numeric === 1) natural = "fumble";
    }
  }

  return { groups: out, total: anyNumeric ? total + modifier : null, natural };
}
