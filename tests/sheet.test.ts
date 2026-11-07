import { describe, expect, it } from "vitest";
import { parseNotation } from "@/lib/dice/notation";
import {
  type Attack,
  attackBonus,
  critNotation,
  d20Notation,
  damageNotation,
  emptyDnd,
  initiativeBonus,
  mod,
  normalizeDnd,
  passivePerception,
  profBonus,
  saveBonus,
  signed,
  skillBonus,
  spellAttack,
  spellDc,
} from "@/lib/sheet";

const sheet = () => {
  const s = emptyDnd();
  s.nivel = 5;
  s.attrs = { for: 16, des: 14, con: 15, int: 8, sab: 12, car: 10 };
  return s;
};
const attack = (patch: Partial<Attack> = {}): Attack => ({ id: "a", nome: "Machado", atributo: "for", proficiente: true, bonus: 0, dano: "1d12+MOD", tipo: "cortante", ...patch });

describe("D&D 5.5 math", () => {
  it("computes modifiers and proficiency by level", () => {
    expect([1, 8, 9, 10, 11, 20, 30].map(mod)).toEqual([-5, -1, -1, 0, 0, 5, 10]);
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profBonus)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it("adds proficiency and expertise to skills", () => {
    const s = sheet();
    expect(skillBonus(s, "atletismo")).toBe(3);
    s.skills.atletismo = 1;
    expect(skillBonus(s, "atletismo")).toBe(6);
    s.skills.atletismo = 2;
    expect(skillBonus(s, "atletismo")).toBe(9);
    expect(skillBonus(s, "não existe")).toBe(0);
  });

  it("computes saves, initiative, passive perception and spellcasting", () => {
    const s = sheet();
    s.saves.con = true;
    expect(saveBonus(s, "con")).toBe(5);
    expect(saveBonus(s, "int")).toBe(-1);
    s.iniciativaExtra = 1;
    expect(initiativeBonus(s)).toBe(3);
    s.skills.percepcao = 1;
    expect(passivePerception(s)).toBe(14);
    expect(spellDc(s)).toBeNull();
    s.magia.atributo = "sab";
    expect(spellDc(s)).toBe(12);
    expect(spellAttack(s)).toBe(4);
  });

  it("computes attack bonuses", () => {
    const s = sheet();
    expect(attackBonus(s, attack())).toBe(6);
    expect(attackBonus(s, attack({ proficiente: false, bonus: 1 }))).toBe(4);
    expect(attackBonus(s, attack({ atributo: "nenhum" }))).toBe(3);
  });
});

describe("roll notation from the sheet", () => {
  it("formats bonuses with a real minus sign", () => {
    expect([3, 0, -2].map(signed)).toEqual(["+3", "+0", "−2"]);
  });

  it("builds d20 tests with advantage and disadvantage", () => {
    expect(d20Notation(5)).toBe("1d20+5");
    expect(d20Notation(0)).toBe("1d20");
    expect(d20Notation(-1)).toBe("1d20-1");
    expect(d20Notation(2, "adv")).toBe("2d20kh1+2");
    expect(d20Notation(2, "dis")).toBe("2d20kl1+2");
  });

  it("replaces MOD in damage with the attribute modifier", () => {
    const s = sheet();
    expect(damageNotation(s, attack())).toBe("1d12+3");
    expect(damageNotation(s, attack({ atributo: "int", dano: "1d10 + MOD" }))).toBe("1d10-1");
    expect(damageNotation(s, attack({ atributo: "car", dano: "2d6+MOD" }))).toBe("2d6");
    expect(damageNotation(s, attack({ dano: "1d8+2d6" }))).toBe("1d8+2d6");
  });

  it("doubles the dice on a critical hit", () => {
    expect(critNotation("1d12+3")).toBe("2d12+3");
    expect(critNotation("d8+2d6+1")).toBe("2d8+4d6+1");
  });

  it("only produces notation the roller understands", () => {
    const s = sheet();
    for (const n of [d20Notation(5, "adv"), d20Notation(-3, "dis"), damageNotation(s, attack()), critNotation(damageNotation(s, attack()))]) {
      expect(() => parseNotation(n)).not.toThrow();
    }
  });
});

describe("normalizeDnd", () => {
  it("fills a blank sheet from nothing", () => {
    expect(normalizeDnd(null)).toMatchObject({ nivel: 1, ca: 10, attrs: { for: 10, car: 10 }, ataques: [] });
  });

  it("clamps and cleans what comes from the database", () => {
    const s = normalizeDnd({
      nivel: 99,
      attrs: { for: 50, des: "14", con: -3 },
      skills: { atletismo: 2, furtividade: 7, inventada: 1 },
      saves: { for: true, des: "sim" },
      ataques: [{ nome: "x".repeat(200), atributo: "hack", dano: "1d6" }],
      magia: { atributo: "lol", slots: [{ total: 4, usados: 9 }] },
      inspiracao: "true",
    });
    expect(s.nivel).toBe(20);
    expect(s.attrs).toMatchObject({ for: 30, des: 14, con: 1, int: 10 });
    expect(s.skills).toEqual({ atletismo: 2, furtividade: 2 });
    expect(s.saves).toMatchObject({ for: true, des: false });
    expect(s.ataques[0].nome).toHaveLength(60);
    expect(s.ataques[0].atributo).toBe("for");
    expect(s.ataques[0].id).toBeTruthy();
    expect(s.magia.atributo).toBe("");
    expect(s.magia.slots[0]).toEqual({ nivel: 1, total: 4, usados: 4 });
    expect(s.inspiracao).toBe(false);
  });
});
