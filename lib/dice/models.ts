import { type SolidId, getSolid, labelOrder, slotCount } from "./geometry";
import { RUNES } from "./runes";
import type { DieSpec } from "./types";

/** One physical body of a die (a d100 is two bodies: tens and units). */
export interface Part {
  solid: SolidId;
  glyph: "text" | "rune";
  /** Label drawn on each slot (face, or vertex for the d4). */
  labelsBySlot: string[];
  /** Cache key for the label texture. */
  atlasKey: string;
  /** Visual tint: the tens die of a d100 is drawn slightly darker. */
  tone?: "tens";
}

export interface PhysicalModel {
  parts: Part[];
  /** Candidate slots, per part, that show the given outcome (1-based). */
  slotsFor(value: number): number[][];
}

const SOLID_FOR_SIDES: Record<number, SolidId> = {
  2: "coin",
  4: "d4",
  6: "d6",
  8: "d8",
  10: "d10",
  12: "d12",
  20: "d20",
  24: "d24",
};

/** Dice with these counts of outcomes are thrown as 3D bodies (d3 and d5 use doubled d6/d10 like real dice). */
export function hasPhysicalModel(die: DieSpec): boolean {
  if (die.type === "pct" || die.type === "rune") return true;
  return die.sides in SOLID_FOR_SIDES || die.sides === 3 || die.sides === 5;
}

function buildPart(
  solid: SolidId,
  labelsInOrder: string[],
  glyph: "text" | "rune",
  tone?: "tens",
): { part: Part; order: number[] } {
  const s = getSolid(solid);
  const order = labelOrder(s);
  const labelsBySlot = new Array<string>(slotCount(s));
  order.forEach((slot, i) => (labelsBySlot[slot] = labelsInOrder[i]));
  return {
    part: { solid, glyph, labelsBySlot, atlasKey: `${solid}|${glyph}|${tone ?? ""}|${labelsBySlot.join("\u0001")}`, tone },
    order,
  };
}

const modelCache = new Map<string, PhysicalModel | null>();

function cacheKey(die: DieSpec): string {
  return `${die.type}|${die.sides}|${(die.faces ?? []).join("\u0001")}`;
}

export function physicalModel(die: DieSpec): PhysicalModel | null {
  const key = cacheKey(die);
  if (modelCache.has(key)) return modelCache.get(key)!;
  const model = makeModel(die);
  modelCache.set(key, model);
  return model;
}

function makeModel(die: DieSpec): PhysicalModel | null {
  if (die.type === "pct") {
    const tens = buildPart("d10", ["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"], "text", "tens");
    const units = buildPart("d10", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], "text");
    return {
      parts: [tens.part, units.part],
      slotsFor(value) {
        const v = value % 100;
        return [[tens.order[Math.floor(v / 10)]], [units.order[v % 10]]];
      },
    };
  }

  if (die.type === "rune") {
    const b = buildPart(
      "d24",
      RUNES.map((r) => r.key),
      "rune",
    );
    return { parts: [b.part], slotsFor: (value) => [[b.order[value - 1]]] };
  }

  const labels: string[] =
    die.type === "faces"
      ? (die.faces ?? []).map((f) => f)
      : Array.from({ length: die.sides }, (_, i) => String(i + 1));

  let solid = SOLID_FOR_SIDES[die.sides];
  let repeat = 1;
  if (!solid && die.sides === 3) {
    solid = "d6";
    repeat = 2;
  } else if (!solid && die.sides === 5) {
    solid = "d10";
    repeat = 2;
  }
  if (!solid) return null;

  // labelsInOrder[i] pairs with labelsInOrder[n-1-i] on opposite faces.
  const labelsInOrder: string[] = [];
  const valueInOrder: number[] = [];
  for (let r = 0; r < repeat; r++)
    labels.forEach((l, i) => {
      labelsInOrder.push(l);
      valueInOrder.push(i + 1);
    });
  const b = buildPart(solid, labelsInOrder, "text");
  return {
    parts: [b.part],
    slotsFor(value) {
      const slots: number[] = [];
      valueInOrder.forEach((v, i) => {
        if (v === value) slots.push(b.order[i]);
      });
      return [slots];
    },
  };
}
