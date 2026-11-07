import { describe, expect, it } from "vitest";
import { NotationError, parseNotation, toNotation } from "@/lib/dice/notation";
import { summarize } from "@/lib/dice/summary";
import { FATE_DIE, RUNE_DIE, type RolledGroup } from "@/lib/dice/types";

describe("parseNotation", () => {
  it("parses simple rolls with modifiers", () => {
    const r = parseNotation("1d20 + 5");
    expect(r.modifier).toBe(5);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ sign: 1, count: 1, die: { type: "std", sides: 20 } });
  });

  it("parses keep and drop", () => {
    expect(parseNotation("2d20kh1").groups[0].keep).toEqual({ mode: "kh", n: 1 });
    expect(parseNotation("4d6k3").groups[0].keep).toEqual({ mode: "kh", n: 3 });
    expect(parseNotation("4d6dl1").groups[0].keep).toEqual({ mode: "dl", n: 1 });
    expect(parseNotation("2d20kl1").groups[0].keep).toEqual({ mode: "kl", n: 1 });
  });

  it("parses special dice", () => {
    expect(parseNotation("d%").groups[0].die).toEqual({ type: "pct", sides: 100 });
    expect(parseNotation("d100").groups[0].die).toEqual({ type: "pct", sides: 100 });
    expect(parseNotation("1dR").groups[0].die).toEqual(RUNE_DIE);
    expect(parseNotation("4dF").groups[0].die).toEqual(FATE_DIE);
    const inline = parseNotation("1d{Sim, Não , Talvez}").groups[0].die;
    expect(inline).toEqual({ type: "faces", sides: 3, faces: ["Sim", "Não", "Talvez"] });
  });

  it("resolves saved custom dice by name, keeping spaces", () => {
    const r = parseNotation("2d[Dado da Sorte] + 1d[Outro]", (name) =>
      name === "Dado da Sorte" ? { type: "faces", sides: 2, faces: ["a", "b"], name } : name === "Outro" ? { type: "std", sides: 7, name } : undefined,
    );
    expect(r.groups.map((g) => g.die.name)).toEqual(["Dado da Sorte", "Outro"]);
  });

  it("handles several groups and negative terms", () => {
    const r = parseNotation("1d8+1d6-1d4-2");
    expect(r.groups.map((g) => g.sign)).toEqual([1, 1, -1]);
    expect(r.modifier).toBe(-2);
    expect(toNotation(r.groups, r.modifier)).toBe("1d8+1d6-1d4-2");
  });

  it("rejects invalid input", () => {
    expect(() => parseNotation("")).toThrow(NotationError);
    expect(() => parseNotation("1d1")).toThrow(NotationError);
    expect(() => parseNotation("5")).toThrow(NotationError);
    expect(() => parseNotation("2d6kh3")).toThrow(NotationError);
    expect(() => parseNotation("1d20 banana")).toThrow(NotationError);
    expect(() => parseNotation("999d6")).toThrow(NotationError);
  });
});

describe("summarize", () => {
  const g = (partial: Partial<RolledGroup> & Pick<RolledGroup, "values" | "die">): RolledGroup => ({
    sign: 1,
    count: partial.values.length,
    ...partial,
  });

  it("totals with modifier and keep highest", () => {
    const s = summarize([g({ die: { type: "std", sides: 20 }, values: [7, 15], keep: { mode: "kh", n: 1 } })], 3);
    expect(s.total).toBe(18);
    expect(s.groups[0].dice.map((d) => d.kept)).toEqual([false, true]);
  });

  it("drops the lowest of 4d6", () => {
    const s = summarize([g({ die: { type: "std", sides: 6 }, values: [3, 1, 6, 1], keep: { mode: "dl", n: 1 } })], 0);
    expect(s.total).toBe(10);
    expect(s.groups[0].dice.filter((d) => !d.kept)).toHaveLength(1);
  });

  it("flags natural 20 and natural 1", () => {
    expect(summarize([g({ die: { type: "std", sides: 20 }, values: [20] })], 5).natural).toBe("crit");
    expect(summarize([g({ die: { type: "std", sides: 20 }, values: [1, 12], keep: { mode: "kl", n: 1 } })], 0).natural).toBe("fumble");
    expect(summarize([g({ die: { type: "std", sides: 20 }, values: [20] }), g({ die: { type: "std", sides: 6 }, values: [3] })], 0).natural).toBeUndefined();
  });

  it("reads Fate dice as numbers", () => {
    const s = summarize([g({ die: FATE_DIE, values: [1, 2, 3, 4] })], 0);
    // faces: + , blank, −, +
    expect(s.total).toBe(1 + 0 - 1 + 1);
  });

  it("does not total runes or text dice", () => {
    const s = summarize([g({ die: RUNE_DIE, values: [5] })], 0);
    expect(s.total).toBeNull();
    expect(s.groups[0].dice[0].rune?.name).toBe("Raidho");
    const t = summarize([g({ die: { type: "faces", sides: 3, faces: ["Sim", "Não", "Talvez"] }, values: [2] })], 0);
    expect(t.total).toBeNull();
    expect(t.groups[0].dice[0].label).toBe("Não");
  });

  it("subtracts negative groups", () => {
    const s = summarize([g({ die: { type: "std", sides: 8 }, values: [5] }), g({ sign: -1, die: { type: "std", sides: 4 }, values: [3] })], 1);
    expect(s.total).toBe(3);
  });
});
