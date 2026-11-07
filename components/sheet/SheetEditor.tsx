"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Ficha, errorMessage, fichaFileUrl, removeFichaFile, saveFicha, subscribeFicha, uploadFichaFile } from "@/lib/api";
import { type DndSheet, type FreeSheet, normalizeDnd, normalizeFree } from "@/lib/sheet";
import { DndSheetView, type SheetRoll } from "./DndSheetView";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Loads, edits and autosaves one character sheet. Read-only when the viewer
 * is not the owner (a game master looking at a player's sheet); then it
 * follows the owner's changes live.
 */
export function SheetEditor({
  ficha,
  readOnly,
  onRoll,
  onRenamed,
  compact,
}: {
  ficha: Ficha;
  readOnly?: boolean;
  onRoll?: SheetRoll;
  onRenamed?: (name: string) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState(ficha.name);
  const [dnd, setDnd] = useState<DndSheet>(() => normalizeDnd(ficha.data));
  const [free, setFree] = useState<FreeSheet>(() => normalizeFree(ficha.data));
  const [file, setFile] = useState<{ path: string | null; kind: Ficha["attachment_kind"]; name: string | null }>({
    path: ficha.attachment_path,
    kind: ficha.attachment_kind,
    name: ficha.attachment_name,
  });
  const [view, setView] = useState<"ficha" | "arquivo">(ficha.system === "livre" && ficha.attachment_path ? "arquivo" : "ficha");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // a different sheet was opened in the same panel
  useEffect(() => {
    setName(ficha.name);
    setDnd(normalizeDnd(ficha.data));
    setFree(normalizeFree(ficha.data));
    setFile({ path: ficha.attachment_path, kind: ficha.attachment_kind, name: ficha.attachment_name });
    setView(ficha.system === "livre" && ficha.attachment_path ? "arquivo" : "ficha");
    setSave("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficha.id]);

  // read-only viewers follow the owner's edits
  useEffect(() => {
    if (!readOnly) return;
    return subscribeFicha(ficha.id, (f) => {
      setName(f.name);
      setDnd(normalizeDnd(f.data));
      setFree(normalizeFree(f.data));
      setFile({ path: f.attachment_path, kind: f.attachment_kind, name: f.attachment_name });
    });
  }, [ficha.id, readOnly]);

  useEffect(() => {
    let alive = true;
    setFileUrl(null);
    if (!file.path) return;
    fichaFileUrl(file.path)
      .then((u) => alive && setFileUrl(u))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [file.path]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setSave("saving");
    try {
      await saveFicha(ficha.id, patch);
      setSave(pending.current ? "pending" : "saved");
    } catch (e) {
      setSave("error");
      setError(errorMessage(e));
      pending.current = { ...patch, ...(pending.current ?? {}) };
    }
  }, [ficha.id]);

  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      if (readOnly) return;
      pending.current = { ...(pending.current ?? {}), ...patch };
      setSave("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush, readOnly],
  );

  // save on unmount / tab close
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      void flush();
    };
  }, [flush]);

  const changeDnd = (next: DndSheet) => {
    setDnd(next);
    queue({ data: next });
  };
  const changeFree = (next: FreeSheet) => {
    setFree(next);
    queue({ data: next });
  };

  const upload = async (f: File) => {
    setError(null);
    setUploading(true);
    try {
      const up = await uploadFichaFile(ficha.owner_id, ficha.id, f);
      const old = file.path;
      await saveFicha(ficha.id, { attachment_path: up.path, attachment_kind: up.kind, attachment_name: f.name.slice(0, 200) });
      setFile({ path: up.path, kind: up.kind, name: f.name });
      setView("arquivo");
      if (old) void removeFichaFile(old);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async () => {
    if (!file.path || !confirm("Remover o arquivo desta ficha?")) return;
    try {
      await saveFicha(ficha.id, { attachment_path: null, attachment_kind: null, attachment_name: null });
      void removeFichaFile(file.path);
      setFile({ path: null, kind: null, name: null });
      setView("ficha");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveLabel = { idle: "", pending: "Alterações não salvas…", saving: "Salvando…", saved: "Salvo", error: "Não salvou" }[save];

  return (
    <div className={`sheet${compact ? " compact" : ""}`}>
      <div className="sheet-head">
        <input
          className="sheet-name"
          value={name}
          disabled={readOnly}
          aria-label="Nome do personagem"
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) {
              queue({ name: e.target.value.trim() });
              onRenamed?.(e.target.value.trim());
            }
          }}
        />
        <div className="sheet-tools">
          {file.path && (
            <div className="seg" role="group" aria-label="Mostrar">
              <button type="button" aria-pressed={view === "ficha"} onClick={() => setView("ficha")}>
                Ficha
              </button>
              <button type="button" aria-pressed={view === "arquivo"} onClick={() => setView("arquivo")}>
                Arquivo
              </button>
            </div>
          )}
          {!readOnly && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
              <button type="button" className="btn btn-small" disabled={uploading} onClick={() => inputRef.current?.click()} title="Enviar a ficha em PDF ou imagem">
                {uploading ? "Enviando…" : file.path ? "Trocar arquivo" : "Enviar PDF/imagem"}
              </button>
              {file.path && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => void removeFile()}>
                  Remover arquivo
                </button>
              )}
            </>
          )}
          <span className={`save-state ${save}`} aria-live="polite">
            {readOnly ? "Somente leitura" : saveLabel}
          </span>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view === "arquivo" && file.path ? (
        <div className="sheet-file">
          {!fileUrl ? (
            <p className="loading">Abrindo arquivo…</p>
          ) : file.kind === "pdf" ? (
            <>
              <iframe src={fileUrl} title={file.name ?? "Ficha em PDF"} />
              <a className="hint" href={fileUrl} target="_blank" rel="noreferrer">
                Abrir o PDF em outra aba
              </a>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={file.name ?? "Ficha"} />
          )}
        </div>
      ) : ficha.system === "livre" ? (
        <div className="free-sheet">
          <textarea
            className="textarea"
            value={free.texto}
            disabled={readOnly}
            placeholder="Escreva a ficha do jeito do seu sistema: atributos, perícias, equipamento, história…"
            onChange={(e) => changeFree({ texto: e.target.value })}
          />
        </div>
      ) : (
        <>
          {onRoll && <p className="hint sheet-hint">Clique nos bônus para rolar. Shift: vantagem. Ctrl: desvantagem.</p>}
          <DndSheetView sheet={dnd} onChange={readOnly ? undefined : changeDnd} onRoll={onRoll} who={name} />
        </>
      )}
    </div>
  );
}
