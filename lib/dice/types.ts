export type DieType = "std" | "pct" | "rune" | "faces";

/** One kind of die. `sides` is always the number of equally likely outcomes. */
export interface DieSpec {
  type: DieType;
  sides: number;
  /** Labels of a custom die, one per outcome (type "faces"). */
  faces?: string[];
  /** Display name of a custom die. */
  name?: string;
  /** Id of a saved custom die. */
  id?: string;
}

export type KeepMode = "kh" | "kl" | "dh" | "dl";

export interface DiceGroup {
  sign: 1 | -1;
  count: number;
  die: DieSpec;
  keep?: { mode: KeepMode; n: number };
}

export interface RollRequest {
  notation: string;
  groups: DiceGroup[];
  modifier: number;
  label?: string;
}

export interface RolledGroup extends DiceGroup {
  /** Outcome per die, 1-based (1..sides). */
  values: number[];
}

export interface Roller {
  id: string;
  name: string;
  color: string;
  /** Rune chosen by the roller's character (Journey to Ragnarok). */
  rune?: string | null;
}

export interface RollRecord {
  id: string;
  notation: string;
  label?: string | null;
  groups: RolledGroup[];
  modifier: number;
  createdAt: string;
  by: Roller;
  isPrivate?: boolean;
  /** Seed for the throw animation, so every screen sees a similar throw. */
  seed: number;
}

export const MAX_DICE = 60;
export const MAX_SIDES = 1000;

export const STANDARD_DICE = [2, 4, 6, 8, 10, 12, 20, 100] as const;

export function stdDie(sides: number): DieSpec {
  if (sides === 100) return { type: "pct", sides: 100 };
  return { type: "std", sides };
}

export const RUNE_DIE: DieSpec = { type: "rune", sides: 24, name: "Runa" };

export const FATE_DIE: DieSpec = { type: "faces", sides: 6, faces: ["+", " ", "−", "+", " ", "−"], name: "Fate" };

export function dieLabel(die: DieSpec): string {
  switch (die.type) {
    case "std":
      return `d${die.sides}`;
    case "pct":
      return "d100";
    case "rune":
      return "Runa";
    case "faces":
      return die.name || `d${die.sides}`;
  }
}
