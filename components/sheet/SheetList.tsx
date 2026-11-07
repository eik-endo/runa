"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Ficha, createFicha, deleteFicha, errorMessage, myFichas } from "@/lib/api";
import { emptyDnd, normalizeDnd } from "@/lib/sheet";
import { toast } from "../Toaster";

export function sheetSubtitle(f: Ficha): string {
  if (f.system === "livre") return f.attachment_name ? `Ficha livre · ${f.attachment_name}` : "Ficha livre";
  const d = normalizeDnd(f.data);
  const cls = [d.classe, d.subclasse].filter(Boolean).join(" / ");
  return [cls || "D&D 5.5", `nível ${d.nivel}`, d.especie].filter(Boolean).join(" · ");
}

export function SheetList({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFichas(await myFichas(ownerId));
    } catch (e) {
      toast(errorMessage(e));
      setFichas([]);
    }
  }, [ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (system: "dnd5e" | "livre") => {
    setBusy(true);
    try {
      const f = await createFicha(system === "dnd5e" ? "Novo personagem" : "Ficha livre", system, system === "dnd5e" ? emptyDnd() : { texto: "" });
      router.push(`/fichas/${f.id}`);
    } catch (e) {
      toast(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className="panel section" id="fichas" aria-labelledby="fichas-titulo">
      <div className="section-head">
        <h2 id="fichas-titulo">Suas fichas</h2>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void create("dnd5e")}>
            Nova ficha D&amp;D 5.5
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void create("livre")} title="Texto livre e PDF/imagem, para qualquer sistema">
            Nova ficha livre
          </button>
        </div>
      </div>
      {fichas === null ? (
        <p className="loading">Carregando…</p>
      ) : fichas.length === 0 ? (
        <div className="empty">
          Crie a ficha do seu personagem. Na mesa, ela abre ao lado dos dados e os bônus rolam com um clique. Também dá para enviar a ficha em PDF ou imagem.
        </div>
      ) : (
        <ul className="list">
          {fichas.map((f) => (
            <li key={f.id} className="camp sheet-item">
              <div className="camp-top">
                <div style={{ minWidth: 0 }}>
                  <div className="camp-title">{f.name}</div>
                  <div className="camp-sub">{sheetSubtitle(f)}</div>
                </div>
                <span className="hint">editada {new Date(f.updated_at).toLocaleDateString("pt-BR")}</span>
              </div>
              <div className="camp-actions">
                <Link className="btn btn-small btn-primary" href={`/fichas/${f.id}`}>
                  Abrir ficha
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={async () => {
                    if (!confirm(`Apagar a ficha "${f.name}"? Isso não pode ser desfeito.`)) return;
                    try {
                      await deleteFicha(f);
                      setFichas((list) => (list ?? []).filter((x) => x.id !== f.id));
                    } catch (e) {
                      toast(errorMessage(e));
                    }
                  }}
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
