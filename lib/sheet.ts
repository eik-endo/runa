/**
 * Character sheet model. D&D 5.5 (2024) and 5e share the same core numbers;
 * names follow the Brazilian Portuguese edition.
 */

export type AttrKey = "for" | "des" | "con" | "int" | "sab" | "car";

export const ATTRS: { key: AttrKey; name: string; short: string }[] = [
  { key: "for", name: "Força", short: "FOR" },
  { key: "des", name: "Destreza", short: "DES" },
  { key: "con", name: "Constituição", short: "CON" },
  { key: "int", name: "Inteligência", short: "INT" },
  { key: "sab", name: "Sabedoria", short: "SAB" },
  { key: "car", name: "Carisma", short: "CAR" },
];

export const SKILLS: { key: string; name: string; attr: AttrKey }[] = [
  { key: "acrobacia", name: "Acrobacia", attr: "des" },
  { key: "arcanismo", name: "Arcanismo", attr: "int" },
  { key: "atletismo", name: "Atletismo", attr: "for" },
  { key: "atuacao", name: "Atuação", attr: "car" },
  { key: "enganacao", name: "Enganação", attr: "car" },
  { key: "furtividade", name: "Furtividade", attr: "des" },
  { key: "historia", name: "História", attr: "int" },
  { key: "intimidacao", name: "Intimidação", attr: "car" },
  { key: "intuicao", name: "Intuição", attr: "sab" },
  { key: "investigacao", name: "Investigação", attr: "int" },
  { key: "lidar", name: "Lidar com Animais", attr: "sab" },
  { key: "medicina", name: "Medicina", attr: "sab" },
  { key: "natureza", name: "Natureza", attr: "int" },
  { key: "percepcao", name: "Percepção", attr: "sab" },
  { key: "persuasao", name: "Persuasão", attr: "car" },
  { key: "prestidigitacao", name: "Prestidigitação", attr: "des" },
  { key: "religiao", name: "Religião", attr: "int" },
  { key: "sobrevivencia", name: "Sobrevivência", attr: "sab" },
];

/** 0: no proficiency, 1: proficient, 2: expertise. */
export type Prof = 0 | 1 | 2;

export interface Attack {
  id: string;
  nome: string;
  atributo: AttrKey | "nenhum";
  proficiente: boolean;
  bonus: number;
  dano: string;
  tipo: string;
}

export interface SpellSlot {
  nivel: number;
  total: number;
  usados: number;
}

export interface DndSheet {
  classe: string;
  subclasse: string;
  nivel: number;
  especie: string;
  antecedente: string;
  alinhamento: string;
  xp: string;
  attrs: Record<AttrKey, number>;
  saves: Record<AttrKey, boolean>;
  skills: Record<string, Prof>;
  ca: number;
  pv: number;
  pvMax: number;
  pvTemp: number;
  deslocamento: string;
  dadosVida: string;
  iniciativaExtra: number;
  inspiracao: boolean;
  morte: { sucessos: number; falhas: number };
  ataques: Attack[];
  magia: { atributo: AttrKey | ""; slots: SpellSlot[]; lista: string };
  moedas: { pc: number; pp: number; pe: number; po: number; pl: number };
  inventario: string;
  caracteristicas: string;
  proficiencias: string;
  notas: string;
}

export interface FreeSheet {
  texto: string;
}

export type SheetSystem = "dnd5e" | "livre";

export function newId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function emptyDnd(): DndSheet {
  return {
    classe: "",
    subclasse: "",
    nivel: 1,
    especie: "",
    antecedente: "",
    alinhamento: "",
    xp: "",
    attrs: { for: 10, des: 10, con: 10, int: 10, sab: 10, car: 10 },
    saves: { for: false, des: false, con: false, int: false, sab: false, car: false },
    skills: {},
    ca: 10,
    pv: 10,
    pvMax: 10,
    pvTemp: 0,
    deslocamento: "9 m",
    dadosVida: "1d8",
    iniciativaExtra: 0,
    inspiracao: false,
    morte: { sucessos: 0, falhas: 0 },
    ataques: [],
    magia: { atributo: "", slots: [], lista: "" },
    moedas: { pc: 0, pp: 0, pe: 0, po: 0, pl: 0 },
    inventario: "",
    caracteristicas: "",
    proficiencias: "",
    notas: "",
  };
}

const num = (v: unknown, d: number, min = -999, max = 9999) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : d;
};
const str = (v: unknown, d = "", max = 4000) => (typeof v === "string" ? v.slice(0, max) : d);

/** Fills in missing fields so older or hand-edited sheets always render. */
export function normalizeDnd(raw: unknown): DndSheet {
  const d = emptyDnd();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const attrs = (r.attrs ?? {}) as Record<string, unknown>;
  const saves = (r.saves ?? {}) as Record<string, unknown>;
  const skills = (r.skills ?? {}) as Record<string, unknown>;
  const morte = (r.morte ?? {}) as Record<string, unknown>;
  const magia = (r.magia ?? {}) as Record<string, unknown>;
  const moedas = (r.moedas ?? {}) as Record<string, unknown>;
  const out: DndSheet = {
    ...d,
    classe: str(r.classe, "", 60),
    subclasse: str(r.subclasse, "", 60),
    nivel: num(r.nivel, 1, 1, 20),
    especie: str(r.especie, "", 60),
    antecedente: str(r.antecedente, "", 60),
    alinhamento: str(r.alinhamento, "", 40),
    xp: str(r.xp, "", 20),
    ca: num(r.ca, 10, 0, 99),
    pv: num(r.pv, 10, -999, 9999),
    pvMax: num(r.pvMax, 10, 0, 9999),
    pvTemp: num(r.pvTemp, 0, 0, 9999),
    deslocamento: str(r.deslocamento, "9 m", 30),
    dadosVida: str(r.dadosVida, "1d8", 30),
    iniciativaExtra: num(r.iniciativaExtra, 0, -20, 20),
    inspiracao: r.inspiracao === true,
    morte: { sucessos: num(morte.sucessos, 0, 0, 3), falhas: num(morte.falhas, 0, 0, 3) },
    inventario: str(r.inventario),
    caracteristicas: str(r.caracteristicas),
    proficiencias: str(r.proficiencias),
    notas: str(r.notas),
    moedas: {
      pc: num(moedas.pc, 0, 0, 9999999),
      pp: num(moedas.pp, 0, 0, 9999999),
      pe: num(moedas.pe, 0, 0, 9999999),
      po: num(moedas.po, 0, 0, 9999999),
      pl: num(moedas.pl, 0, 0, 9999999),
    },
    magia: {
      atributo: (["for", "des", "con", "int", "sab", "car"].includes(String(magia.atributo)) ? magia.atributo : "") as AttrKey | "",
      lista: str(magia.lista),
      slots: Array.isArray(magia.slots)
        ? (magia.slots as Record<string, unknown>[]).slice(0, 9).map((s, i) => {
            const total = num(s?.total, 0, 0, 9);
            return { nivel: num(s?.nivel, i + 1, 1, 9), total, usados: Math.min(total, num(s?.usados, 0, 0, 9)) };
          })
        : [],
    },
    ataques: Array.isArray(r.ataques)
      ? (r.ataques as Record<string, unknown>[]).slice(0, 30).map((a) => ({
          id: str(a?.id) || newId(),
          nome: str(a?.nome, "", 60),
          atributo: (["for", "des", "con", "int", "sab", "car", "nenhum"].includes(String(a?.atributo)) ? a.atributo : "for") as Attack["atributo"],
          proficiente: a?.proficiente !== false,
          bonus: num(a?.bonus, 0, -20, 20),
          dano: str(a?.dano, "", 40),
          tipo: str(a?.tipo, "", 30),
        }))
      : [],
    attrs: { ...d.attrs },
    saves: { ...d.saves },
    skills: {},
  };
  for (const a of ATTRS) {
    out.attrs[a.key] = num(attrs[a.key], 10, 1, 30);
    out.saves[a.key] = saves[a.key] === true;
  }
  for (const s of SKILLS) {
    const v = num(skills[s.key], 0, 0, 2);
    if (v) out.skills[s.key] = v as Prof;
  }
  return out;
}

export function normalizeFree(raw: unknown): FreeSheet {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { texto: str(r.texto, "", 20000) };
}

export const mod = (score: number) => Math.floor((score - 10) / 2);

export const profBonus = (level: number) => 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);

export function skillBonus(s: DndSheet, key: string): number {
  const skill = SKILLS.find((k) => k.key === key);
  if (!skill) return 0;
  return mod(s.attrs[skill.attr]) + (s.skills[key] ?? 0) * profBonus(s.nivel);
}

export function saveBonus(s: DndSheet, a: AttrKey): number {
  return mod(s.attrs[a]) + (s.saves[a] ? profBonus(s.nivel) : 0);
}

export function initiativeBonus(s: DndSheet): number {
  return mod(s.attrs.des) + s.iniciativaExtra;
}

export function attackBonus(s: DndSheet, a: Attack): number {
  const base = a.atributo === "nenhum" ? 0 : mod(s.attrs[a.atributo]);
  return base + (a.proficiente ? profBonus(s.nivel) : 0) + a.bonus;
}

export function passivePerception(s: DndSheet): number {
  return 10 + skillBonus(s, "percepcao");
}

export function spellDc(s: DndSheet): number | null {
  if (!s.magia.atributo) return null;
  return 8 + profBonus(s.nivel) + mod(s.attrs[s.magia.atributo]);
}

export function spellAttack(s: DndSheet): number | null {
  if (!s.magia.atributo) return null;
  return profBonus(s.nivel) + mod(s.attrs[s.magia.atributo]);
}

/** "+3", "−1", "+0" (typographic minus). */
export function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/** Notation for a d20 test: advantage keeps the highest of 2d20. */
export function d20Notation(bonus: number, mode: "normal" | "adv" | "dis" = "normal"): string {
  const dice = mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20";
  return bonus ? `${dice}${bonus > 0 ? "+" : "-"}${Math.abs(bonus)}` : dice;
}

/** Damage notation with the ability modifier folded in when the user wrote "+MOD". */
export function damageNotation(s: DndSheet, a: Attack): string {
  const m = a.atributo === "nenhum" ? 0 : mod(s.attrs[a.atributo]);
  const raw = a.dano.replace(/\s+/g, "").replace(/−/g, "-");
  if (/mod/i.test(raw)) {
    const replaced = raw.replace(/([+-]?)mod/i, (_, sign: string) => {
      const v = sign === "-" ? -m : m;
      return v >= 0 ? `+${v}` : `${v}`;
    });
    return replaced.replace(/^\+/, "").replace(/\+-/g, "-").replace(/\+0(?!\d)/g, "");
  }
  return raw;
}

/** Critical hit: every die in the damage roll is doubled (1d8+3 → 2d8+3). */
export function critNotation(damage: string): string {
  return damage.replace(/(\d*)d(\d+)/gi, (_, c: string, f: string) => `${(parseInt(c || "1", 10) || 1) * 2}d${f}`);
}
