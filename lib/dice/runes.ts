/**
 * The 24 runes of the Elder Futhark, in their three ættir.
 * Glyphs are drawn as strokes in a 1×1 box (x → right, y → down), so they look
 * carved and never depend on a font having the Runic Unicode block.
 * Meanings are short traditional readings, written for this app.
 */

export type AettId = "freyr" | "heimdall" | "tyr";

export interface Rune {
  key: string;
  name: string;
  char: string;
  aett: AettId;
  meaning: string;
  strokes: number[][];
}

export const AETTIR: Record<AettId, { name: string; short: string }> = {
  freyr: { name: "Ætt de Freyr", short: "Freyr" },
  heimdall: { name: "Ætt de Heimdall", short: "Heimdall" },
  tyr: { name: "Ætt de Týr", short: "Týr" },
};

export const RUNES: Rune[] = [
  // Ætt de Freyr
  { key: "fehu", name: "Fehu", char: "ᚠ", aett: "freyr", meaning: "Riqueza, gado, ganho conquistado", strokes: [[0.32, 0, 0.32, 1], [0.32, 0.3, 0.74, 0.02], [0.32, 0.56, 0.74, 0.28]] },
  { key: "uruz", name: "Uruz", char: "ᚢ", aett: "freyr", meaning: "Força bruta, vigor, o auroque", strokes: [[0.26, 1, 0.26, 0, 0.74, 0.34, 0.74, 1]] },
  { key: "thurisaz", name: "Thurisaz", char: "ᚦ", aett: "freyr", meaning: "Espinho, gigante, conflito", strokes: [[0.32, 0, 0.32, 1], [0.32, 0.24, 0.72, 0.5, 0.32, 0.76]] },
  { key: "ansuz", name: "Ansuz", char: "ᚨ", aett: "freyr", meaning: "Palavra, sabedoria, o sopro de Odin", strokes: [[0.32, 0, 0.32, 1], [0.32, 0.04, 0.74, 0.34], [0.32, 0.34, 0.74, 0.64]] },
  { key: "raidho", name: "Raidho", char: "ᚱ", aett: "freyr", meaning: "Jornada, cavalgada, o caminho certo", strokes: [[0.3, 1, 0.3, 0, 0.72, 0.25, 0.3, 0.5, 0.74, 1]] },
  { key: "kenaz", name: "Kenaz", char: "ᚲ", aett: "freyr", meaning: "Tocha, conhecimento, a chama que revela", strokes: [[0.7, 0.14, 0.3, 0.5, 0.7, 0.86]] },
  { key: "gebo", name: "Gebo", char: "ᚷ", aett: "freyr", meaning: "Dádiva, troca, aliança", strokes: [[0.2, 0.06, 0.8, 0.94], [0.8, 0.06, 0.2, 0.94]] },
  { key: "wunjo", name: "Wunjo", char: "ᚹ", aett: "freyr", meaning: "Alegria, harmonia, pertencimento", strokes: [[0.32, 1, 0.32, 0, 0.72, 0.25, 0.32, 0.5]] },
  // Ætt de Heimdall
  { key: "hagalaz", name: "Hagalaz", char: "ᚺ", aett: "heimdall", meaning: "Granizo, ruptura, força da natureza", strokes: [[0.26, 0, 0.26, 1], [0.74, 0, 0.74, 1], [0.26, 0.34, 0.74, 0.66]] },
  { key: "naudiz", name: "Naudiz", char: "ᚾ", aett: "heimdall", meaning: "Necessidade, provação, resistência", strokes: [[0.5, 0, 0.5, 1], [0.28, 0.34, 0.72, 0.62]] },
  { key: "isa", name: "Isa", char: "ᛁ", aett: "heimdall", meaning: "Gelo, imobilidade, espera", strokes: [[0.5, 0, 0.5, 1]] },
  { key: "jera", name: "Jera", char: "ᛃ", aett: "heimdall", meaning: "Ano, colheita, o ciclo que se cumpre", strokes: [[0.47, 0.1, 0.22, 0.34, 0.47, 0.58], [0.53, 0.42, 0.78, 0.66, 0.53, 0.9]] },
  { key: "eihwaz", name: "Eihwaz", char: "ᛇ", aett: "heimdall", meaning: "Teixo, resistência, morte e renascimento", strokes: [[0.5, 0, 0.5, 1], [0.5, 0.02, 0.76, 0.24], [0.5, 0.98, 0.24, 0.76]] },
  { key: "perthro", name: "Perthro", char: "ᛈ", aett: "heimdall", meaning: "Destino, sorte, o que está oculto", strokes: [[0.3, 0, 0.3, 1], [0.3, 0.02, 0.62, 0.3, 0.76, 0.14], [0.3, 0.98, 0.62, 0.7, 0.76, 0.86]] },
  { key: "algiz", name: "Algiz", char: "ᛉ", aett: "heimdall", meaning: "Proteção, defesa, o alce", strokes: [[0.5, 0, 0.5, 1], [0.5, 0.46, 0.2, 0.08], [0.5, 0.46, 0.8, 0.08]] },
  { key: "sowilo", name: "Sowilo", char: "ᛊ", aett: "heimdall", meaning: "Sol, vitória, clareza", strokes: [[0.66, 0, 0.3, 0.38, 0.7, 0.62, 0.34, 1]] },
  // Ætt de Týr
  { key: "tiwaz", name: "Tiwaz", char: "ᛏ", aett: "tyr", meaning: "Týr, justiça, honra e sacrifício", strokes: [[0.5, 0, 0.5, 1], [0.18, 0.32, 0.5, 0.02, 0.82, 0.32]] },
  { key: "berkano", name: "Berkano", char: "ᛒ", aett: "tyr", meaning: "Bétula, nascimento, cura", strokes: [[0.3, 0, 0.3, 1], [0.3, 0, 0.7, 0.25, 0.3, 0.5, 0.7, 0.75, 0.3, 1]] },
  { key: "ehwaz", name: "Ehwaz", char: "ᛖ", aett: "tyr", meaning: "Cavalo, parceria, movimento", strokes: [[0.24, 1, 0.24, 0, 0.5, 0.3, 0.76, 0, 0.76, 1]] },
  { key: "mannaz", name: "Mannaz", char: "ᛗ", aett: "tyr", meaning: "Humanidade, o eu entre os outros", strokes: [[0.24, 1, 0.24, 0], [0.76, 1, 0.76, 0], [0.24, 0, 0.76, 0.46], [0.76, 0, 0.24, 0.46]] },
  { key: "laguz", name: "Laguz", char: "ᛚ", aett: "tyr", meaning: "Água, lago, intuição", strokes: [[0.36, 1, 0.36, 0, 0.72, 0.3]] },
  { key: "ingwaz", name: "Ingwaz", char: "ᛜ", aett: "tyr", meaning: "Semente, potencial, Ing (Freyr)", strokes: [[0.5, 0.18, 0.82, 0.5, 0.5, 0.82, 0.18, 0.5, 0.5, 0.18]] },
  { key: "dagaz", name: "Dagaz", char: "ᛞ", aett: "tyr", meaning: "Dia, despertar, transformação", strokes: [[0.18, 0.08, 0.18, 0.92, 0.82, 0.08, 0.82, 0.92, 0.18, 0.08]] },
  { key: "othala", name: "Othala", char: "ᛟ", aett: "tyr", meaning: "Herança, lar, ancestrais", strokes: [[0.24, 1, 0.78, 0.4, 0.5, 0.02, 0.22, 0.4, 0.76, 1]] },
];

export const RUNE_BY_KEY: Record<string, Rune> = Object.fromEntries(RUNES.map((r) => [r.key, r]));

export function runeAt(index1: number): Rune {
  return RUNES[(((index1 - 1) % 24) + 24) % 24];
}

/** SVG path data for a rune glyph in a 0..100 box. */
export function runePath(rune: Rune): string {
  return rune.strokes
    .map((s) => {
      let d = "";
      for (let i = 0; i < s.length; i += 2) d += `${i === 0 ? "M" : "L"}${(s[i] * 100).toFixed(1)} ${(s[i + 1] * 100).toFixed(1)}`;
      return d;
    })
    .join(" ");
}
