"use client";

import { useState } from "react";
import { Dialog } from "./Dialog";
import { ColorPicker, RunePicker } from "./pickers";

export interface CharacterValue {
  character_name: string;
  character_notes: string;
  rune: string | null;
  color: string;
}

export function CharacterDialog({
  mesaName,
  runeSystem,
  initial,
  onSave,
  onClose,
}: {
  mesaName: string;
  runeSystem: boolean;
  initial: CharacterValue;
  onSave: (v: CharacterValue) => Promise<void>;
  onClose: () => void;
}) {
  const [v, setV] = useState<CharacterValue>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={`Seu personagem em ${mesaName}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          try {
            await onSave({ ...v, character_name: v.character_name.trim() });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível salvar.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="field">
          <span>Nome do personagem</span>
          <input
            className="input"
            value={v.character_name}
            onChange={(e) => setV({ ...v, character_name: e.target.value })}
            maxLength={60}
            placeholder="Aparece nas suas rolagens desta mesa"
          />
        </label>
        <label className="field">
          <span>Anotações</span>
          <textarea
            className="textarea"
            value={v.character_notes}
            onChange={(e) => setV({ ...v, character_notes: e.target.value })}
            maxLength={4000}
            placeholder="Classe, nível, ideias… Só você e o mestre veem."
          />
        </label>
        <ColorPicker value={v.color} onChange={(color) => setV({ ...v, color })} label="Cor dos dados nesta mesa" />
        {runeSystem && <RunePicker value={v.rune} onChange={(rune) => setV({ ...v, rune })} />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar personagem"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
