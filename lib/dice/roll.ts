import { type PhysicalModel, physicalModel } from "./models";
import { type DieLook, labelColorFor, shadeHex } from "./mesh";
import { mulberry32 } from "./physics";
import { type RollOutcome, summarize } from "./summary";
import type { TrayDie, TrayThrow } from "./tray";
import type { RollRecord, RollRequest, Roller, RolledGroup } from "./types";

/** Uniform integer in 1..n from the browser's cryptographic RNG. */
export function secureInt(n: number): number {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return 1 + Math.floor(Math.random() * n);
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return 1 + (buf[0] % n);
  }
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Rolls on this device (solo table). */
export function rollLocally(req: RollRequest, by: Roller): RollRecord {
  const groups: RolledGroup[] = req.groups.map((g) => ({
    ...g,
    values: Array.from({ length: g.count }, () => secureInt(g.die.sides)),
  }));
  return {
    id: newId(),
    notation: req.notation,
    label: req.label || null,
    groups,
    modifier: req.modifier,
    createdAt: new Date().toISOString(),
    by,
    seed: secureInt(2 ** 30),
  };
}

export const RUNE_LOOK: DieLook = { base: "#3f4442", label: "#ffcf7a", glow: "#d9821f", matte: true };

export function lookFor(color: string): DieLook {
  return { base: color, label: labelColorFor(color) };
}

export interface FlatDie {
  label: string;
  dropped: boolean;
  look: DieLook;
}

export interface PreparedThrow {
  outcome: RollOutcome;
  tray: TrayThrow;
  flat: FlatDie[];
}

/** Splits a roll into dice thrown in 3D and dice shown flat (no solid exists for them). */
export function prepareThrow(record: RollRecord): PreparedThrow {
  const outcome = summarize(record.groups, record.modifier);
  const rnd = mulberry32(record.seed ^ 0x5bd1e995);
  const dice: TrayDie[] = [];
  const flat: FlatDie[] = [];
  const base = lookFor(record.by.color);
  record.groups.forEach((g, gi) => {
    const model: PhysicalModel | null = physicalModel(g.die);
    g.values.forEach((value, di) => {
      const kept = outcome.groups[gi].dice[di].kept;
      if (!model) {
        flat.push({ label: outcome.groups[gi].dice[di].label, dropped: !kept, look: base });
        return;
      }
      const choices = model.slotsFor(value);
      model.parts.forEach((part, pi) => {
        const options = choices[pi];
        const slot = options[Math.floor(rnd() * options.length)];
        let look = base;
        if (part.glyph === "rune") look = RUNE_LOOK;
        else if (part.tone === "tens") {
          const darker = shadeHex(record.by.color, -0.35);
          look = { base: darker, label: labelColorFor(darker) };
        }
        dice.push({ part, look, slot, dropped: !kept });
      });
    });
  });
  return { outcome, tray: { id: record.id, seed: record.seed, dice }, flat };
}
