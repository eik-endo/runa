"use client";

import { useState } from "react";

export const SYSTEMS = ["D&D 5.5", "D&D 5e", "Pathfinder 2e", "Tormenta20", "Ordem Paranormal", "Call of Cthulhu", "Vampiro", "Outro"];

export interface MesaFormValue {
  name: string;
  system: string;
  description: string;
  runeSystem: boolean;
}

export function MesaFields({ value, onChange }: { value: MesaFormValue; onChange: (v: MesaFormValue) => void }) {
  const known = SYSTEMS.includes(value.system);
  const [custom, setCustom] = useState(!known);
  return (
    <>
      <label className="field">
        <span>Nome da campanha</span>
        <input
          className="input"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          maxLength={80}
          required
          placeholder="Ex.: Jornada ao Ragnarök"
        />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Sistema</span>
          <select
            className="select"
            value={custom ? "Outro" : value.system}
            onChange={(e) => {
              const v = e.target.value;
              setCustom(v === "Outro");
              onChange({ ...value, system: v === "Outro" ? "" : v });
            }}
          >
            {SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {custom && (
          <label className="field">
            <span>Qual sistema?</span>
            <input className="input" value={value.system} onChange={(e) => onChange({ ...value, system: e.target.value })} maxLength={60} />
          </label>
        )}
      </div>
      <label className="field">
        <span>Descrição (opcional)</span>
        <textarea
          className="textarea"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          maxLength={4000}
          placeholder="Dia e horário das sessões, onde vocês pararam, combinados da mesa…"
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={value.runeSystem} onChange={(e) => onChange({ ...value, runeSystem: e.target.checked })} />
        Usar runas de personagem (sistema de runas de Journey to Ragnarok)
      </label>
    </>
  );
}
