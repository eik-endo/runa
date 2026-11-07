"use client";

import { DICE_COLORS } from "@/lib/colors";
import { AETTIR, type AettId, RUNES } from "@/lib/dice/runes";
import { RuneGlyph } from "./glyphs";

export function ColorPicker({ value, onChange, label = "Cor dos seus dados" }: { value: string; onChange: (hex: string) => void; label?: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {DICE_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.hex}
            aria-label={c.name}
            title={c.name}
            className="swatch"
            style={{ background: c.hex }}
            onClick={() => onChange(c.hex)}
          />
        ))}
      </div>
    </div>
  );
}

export function RunePicker({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const aettir: AettId[] = ["freyr", "heimdall", "tyr"];
  return (
    <div className="field">
      <span>Runa do personagem</span>
      <p className="hint">Quando o dado rúnico mostrar a sua runa ou outra runa do mesmo ætt, a rolagem ganha um destaque.</p>
      <div className="rune-grid" role="radiogroup" aria-label="Runa do personagem">
        {aettir.map((a) => (
          <div key={a} style={{ display: "contents" }}>
            <span className="aett-label">{AETTIR[a].name}</span>
            {RUNES.filter((r) => r.aett === a).map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={value === r.key}
                className="rune-pick"
                title={`${r.name}: ${r.meaning}`}
                onClick={() => onChange(value === r.key ? null : r.key)}
              >
                <RuneGlyph rune={r} size={22} />
                {r.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
