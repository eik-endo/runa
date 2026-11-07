import {
  type DiceGroup,
  type DieSpec,
  type KeepMode,
  FATE_DIE,
  MAX_DICE,
  MAX_SIDES,
  RUNE_DIE,
  stdDie,
} from "./types";

export interface ParsedRoll {
  groups: DiceGroup[];
  modifier: number;
}

export class NotationError extends Error {}

/**
 * Parses dice notation such as `1d20+5`, `2d20kh1`, `4d6k3`, `d%`, `3dF`,
 * `dR` (rune die), `2d[Sorte]` (saved custom die by name) or
 * `1d{Sim,Não,Talvez}` (inline custom faces).
 */
/** Removes whitespace outside of [name] and {faces}, normalising the minus sign. */
function compact(input: string): string {
  let out = "";
  let close: string | null = null;
  for (const ch of input) {
    if (close) {
      out += ch;
      if (ch === close) close = null;
      continue;
    }
    if (ch === "[" || ch === "{") {
      close = ch === "[" ? "]" : "}";
      out += ch;
      continue;
    }
    if (/\s/.test(ch)) continue;
    out += ch === "\u2212" ? "-" : ch;
  }
  return out;
}

export function parseNotation(input: string, resolveCustom?: (name: string) => DieSpec | undefined): ParsedRoll {
  const src = compact(input);
  if (!src) throw new NotationError("Digite uma rolagem, por exemplo 1d20+5.");
  let i = 0;
  const groups: DiceGroup[] = [];
  let modifier = 0;
  let total = 0;

  const peek = () => src[i];
  const readInt = (): number | null => {
    const m = /^\d+/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseInt(m[0], 10);
  };

  let first = true;
  while (i < src.length) {
    let sign: 1 | -1 = 1;
    if (peek() === "+" || peek() === "-") {
      sign = peek() === "-" ? -1 : 1;
      i++;
    } else if (!first) {
      throw new NotationError(`Esperava + ou - na posição ${i + 1}.`);
    }
    first = false;
    const count = readInt();
    const c = peek();
    if (c === "d" || c === "D") {
      i++;
      const n = count ?? 1;
      if (n < 1) throw new NotationError("A quantidade de dados precisa ser pelo menos 1.");
      let die: DieSpec | undefined;
      const ch = peek();
      if (ch === "%") {
        i++;
        die = stdDie(100);
      } else if (ch === "R" || ch === "r") {
        i++;
        die = RUNE_DIE;
      } else if (ch === "F" || ch === "f") {
        i++;
        die = FATE_DIE;
      } else if (ch === "[") {
        const end = src.indexOf("]", i);
        if (end < 0) throw new NotationError("Faltou fechar ] no nome do dado.");
        const name = src.slice(i + 1, end).trim();
        i = end + 1;
        die = resolveCustom?.(name);
        if (!die) throw new NotationError(`Não encontrei o dado "${name}".`);
      } else if (ch === "{") {
        const end = src.indexOf("}", i);
        if (end < 0) throw new NotationError("Faltou fechar } nas faces do dado.");
        const faces = src
          .slice(i + 1, end)
          .split(",")
          .map((f) => f.trim());
        i = end + 1;
        if (faces.length < 2) throw new NotationError("Um dado precisa de pelo menos 2 faces.");
        die = { type: "faces", sides: faces.length, faces };
      } else {
        const sides = readInt();
        if (sides === null) throw new NotationError("Faltou o número de lados depois do d.");
        if (sides < 2 || sides > MAX_SIDES) throw new NotationError(`Dados vão de d2 a d${MAX_SIDES}.`);
        die = stdDie(sides);
      }
      let keep: DiceGroup["keep"];
      const km = /^(kh|kl|dh|dl|k|d)(\d+)?/i.exec(src.slice(i));
      if (km) {
        i += km[0].length;
        let mode = km[1].toLowerCase();
        if (mode === "k") mode = "kh";
        if (mode === "d") mode = "dl";
        const kn = km[2] ? parseInt(km[2], 10) : 1;
        if (kn < 1 || kn > n) throw new NotationError("Não dá para manter ou descartar mais dados do que foram rolados.");
        keep = { mode: mode as KeepMode, n: kn };
      }
      total += n;
      if (total > MAX_DICE) throw new NotationError(`No máximo ${MAX_DICE} dados por rolagem.`);
      groups.push({ sign, count: n, die, keep });
    } else {
      if (count === null) throw new NotationError(`Não entendi "${src.slice(i)}".`);
      modifier += sign * count;
    }
  }
  if (!groups.length) throw new NotationError("Inclua pelo menos um dado, por exemplo 1d20.");
  return { groups, modifier };
}

export function dieToken(die: DieSpec): string {
  switch (die.type) {
    case "std":
      return `d${die.sides}`;
    case "pct":
      return "d100";
    case "rune":
      return "dR";
    case "faces":
      if (die.name === FATE_DIE.name && die.faces?.join("") === FATE_DIE.faces!.join("")) return "dF";
      if (die.name) return `d[${die.name}]`;
      return `d{${(die.faces ?? []).join(",")}}`;
  }
}

export function toNotation(groups: DiceGroup[], modifier: number): string {
  let s = "";
  groups.forEach((g, idx) => {
    const sign = g.sign < 0 ? "-" : idx === 0 ? "" : "+";
    const keep = g.keep ? `${g.keep.mode}${g.keep.n}` : "";
    s += `${sign}${g.count}${dieToken(g.die)}${keep}`;
  });
  if (modifier) s += modifier > 0 ? `+${modifier}` : `${modifier}`;
  return s;
}
