"use client";

import { useState } from "react";

export const SYSTEMS = ["D&D 5.5", "D&D 5e", "Pathfinder 2e", "Tormenta20", "Ordem Paranormal", "Call of Cthulhu", "Vampiro", "Outro"];

export interface MesaFormValue {
  name: string;
  system: string;
  description: string;
  runeSystem: boolean;
  visibility: "publica" | "privada";
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
      <fieldset className="field visibility">
        <span>Quem pode entrar</span>
        <label className={`choice${value.visibility === "privada" ? " on" : ""}`}>
          <input type="radio" name="visibility" checked={value.visibility === "privada"} onChange={() => onChange({ ...value, visibility: "privada" })} />
          <span>
            <b>Privada</b>
            <span className="hint">Aparece na busca, mas só entra quem tem o código.</span>
          </span>
        </label>
        <label className={`choice${value.visibility === "publica" ? " on" : ""}`}>
          <input type="radio" name="visibility" checked={value.visibility === "publica"} onChange={() => onChange({ ...value, visibility: "publica" })} />
          <span>
            <b>Pública</b>
            <span className="hint">Qualquer pessoa entra pela busca de mesas.</span>
          </span>
        </label>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={value.runeSystem} onChange={(e) => onChange({ ...value, runeSystem: e.target.checked })} />
        Usar runas de personagem (sistema de runas de Journey to Ragnarok)
      </label>
    </>
  );
}
