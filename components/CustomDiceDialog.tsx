"use client";

import { useState } from "react";
import { hasPhysicalModel } from "@/lib/dice/models";
import { type DieSpec, MAX_SIDES } from "@/lib/dice/types";
import { Dialog } from "./Dialog";
import { Icon } from "./glyphs";

export interface CustomDieDraft {
  name: string;
  die: DieSpec;
  shared: boolean;
}

function describe(d: DieSpec) {
  if (d.type === "faces") return (d.faces ?? []).map((f) => f.trim() || "(vazio)").join(" · ");
  return `Números de 1 a ${d.sides}`;
}

export function CustomDiceDialog({
  dice,
  onCreate,
  onDelete,
  onClose,
  showShareOption,
  canDelete = () => true,
  tag,
  intro,
}: {
  dice: DieSpec[];
  onCreate: (draft: CustomDieDraft) => Promise<void> | void;
  onDelete: (d: DieSpec) => Promise<void> | void;
  onClose: () => void;
  /** Shows "available to everyone at the table" (game master at an online table). */
  showShareOption?: boolean;
  canDelete?: (d: DieSpec) => boolean;
  /** Small label next to a die, e.g. "da mesa". */
  tag?: (d: DieSpec) => string | null;
  intro?: string;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"faces" | "numbers">("faces");
  const [facesText, setFacesText] = useState("");
  const [sides, setSides] = useState(7);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const faces = facesText
    .split(/\n|,/)
    .map((f) => f.trim())
    .filter((f, i, all) => f.length > 0 || (all.length > 1 && i < all.length - 1));

  const draftDie: DieSpec | null =
    kind === "faces"
      ? faces.length >= 2
        ? { type: "faces", sides: faces.length, faces, name: name.trim() }
        : null
      : sides >= 2 && sides <= MAX_SIDES
        ? { type: "std", sides, name: name.trim() }
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) return setError("Dê um nome ao dado.");
    if (n.length > 30) return setError("Use um nome com até 30 letras.");
    if (dice.some((d) => (d.name ?? "").toLowerCase() === n.toLowerCase())) return setError("Já existe um dado com esse nome.");
    if (kind === "faces") {
      if (faces.length < 2) return setError("Escreva pelo menos 2 faces, uma por linha.");
      if (faces.length > 100) return setError("Use no máximo 100 faces.");
      if (faces.some((f) => f.length > 18)) return setError("Cada face pode ter até 18 letras.");
    }
    if (!draftDie) return setError(`O número de lados vai de 2 a ${MAX_SIDES}.`);
    setSaving(true);
    try {
      await onCreate({ name: n, die: draftDie, shared });
      setName("");
      setFacesText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o dado.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title="Dados personalizados" onClose={onClose}>
      {intro && <p className="hint">{intro}</p>}
      {dice.length > 0 && (
        <ul className="custom-list">
          {dice.map((d) => (
            <li key={d.id ?? d.name} className="custom-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{d.name}</b>
                <div className="faces">{describe(d)}</div>
              </div>
              {tag?.(d) && <span className="badge">{tag(d)}</span>}
              {canDelete(d) && (
                <button type="button" className="icon-btn" onClick={() => onDelete(d)} aria-label={`Apagar ${d.name}`}>
                  <Icon name="trash" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="form" onSubmit={submit}>
        <h3>Criar dado</h3>
        <label className="field">
          <span>Nome</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sorte, Clima, Oráculo" maxLength={30} />
        </label>
        <div className="seg" role="group" aria-label="Tipo de dado">
          <button type="button" aria-pressed={kind === "faces"} onClick={() => setKind("faces")}>
            Faces com nomes
          </button>
          <button type="button" aria-pressed={kind === "numbers"} onClick={() => setKind("numbers")}>
            Números (dN)
          </button>
        </div>
        {kind === "faces" ? (
          <label className="field">
            <span>Faces (uma por linha)</span>
            <textarea
              className="textarea"
              value={facesText}
              onChange={(e) => setFacesText(e.target.value)}
              placeholder={"Sim\nNão\nTalvez"}
              rows={5}
            />
          </label>
        ) : (
          <label className="field">
            <span>Quantidade de lados</span>
            <input
              className="input"
              type="number"
              min={2}
              max={MAX_SIDES}
              value={sides}
              onChange={(e) => setSides(parseInt(e.target.value || "0", 10))}
            />
          </label>
        )}
        {draftDie && (
          <p className="hint">
            {hasPhysicalModel(draftDie)
              ? "Esse dado tem um formato real, então ele é jogado em 3D."
              : "Não existe um sólido com essa quantidade de faces: ele aparece como ficha, sem física."}
          </p>
        )}
        {showShareOption && (
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Disponível para todos na mesa
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <span className="spacer" />
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar dado"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
