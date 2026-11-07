"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, loadNotes, saveNotes } from "@/lib/api";

/** Private notes of the game master for this table, saved as they type. */
export function MasterNotes({ mesaId }: { mesaId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => {
    loadNotes(mesaId)
      .then((t) => {
        latest.current = t;
        setText(t);
      })
      .catch(() => setText(""));
  }, [mesaId]);

  const save = async () => {
    timer.current = null;
    setState("saving");
    try {
      await saveNotes(mesaId, latest.current);
      setState(timer.current ? "pending" : "saved");
    } catch (e) {
      console.warn(errorMessage(e));
      setState("error");
    }
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveNotes(mesaId, latest.current);
      }
    },
    [mesaId],
  );

  if (text === null) return <p className="loading">Carregando notas…</p>;
  return (
    <div className="notes">
      <div className="row">
        <span className="hint">Só você vê estas notas.</span>
        <span className="spacer" />
        <span className={`save-state ${state}`}>{{ idle: "", pending: "Não salvo…", saving: "Salvando…", saved: "Salvo", error: "Não salvou" }[state]}</span>
      </div>
      <textarea
        className="textarea notes-text"
        value={text}
        maxLength={20000}
        placeholder="Ganchos, nomes de NPCs, o que cada jogador sabe, o que acontece se eles abrirem a porta errada…"
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          setState("pending");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 900);
        }}
      />
    </div>
  );
}
