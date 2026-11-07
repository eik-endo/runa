"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CodeBox } from "@/components/CodeBox";
import { MesaFields, type MesaFormValue } from "@/components/MesaForm";
import { RequireAccount } from "@/components/OnlineGate";
import { type MesaSummary, createMesa, errorMessage, myMesas } from "@/lib/api";

function when(iso: string | null) {
  if (!iso) return "sem rolagens ainda";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "rolou agora há pouco";
  if (diff < 3600) return `última rolagem há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `última rolagem há ${Math.floor(diff / 3600)} h`;
  return `última rolagem em ${d.toLocaleDateString("pt-BR")}`;
}

function MestreArea() {
  const router = useRouter();
  const { profile } = useAuth();
  const [mesas, setMesas] = useState<MesaSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<MesaFormValue>({ name: "", system: "D&D 5.5", description: "", runeSystem: false, visibility: "privada" });
  const [creating, setCreating] = useState(false);
  const [quickName, setQuickName] = useState("");

  const load = useCallback(async () => {
    try {
      setMesas((await myMesas()).filter((m) => m.role === "mestre"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const m = await createMesa({
        name: form.name,
        kind: "campanha",
        system: form.system,
        description: form.description,
        runeSystem: form.runeSystem,
        visibility: form.visibility,
      });
      router.push(`/mestre/${m.id}?nova=1`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  };

  const createQuick = async () => {
    setError(null);
    setCreating(true);
    try {
      const m = await createMesa({ name: quickName.trim() || `Mesa de ${profile?.display_name ?? "jogo"}`, kind: "avulsa" });
      router.push(`/mesa/${m.code}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  };

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel section" aria-labelledby="suas-campanhas">
        <div className="section-head">
          <h2 id="suas-campanhas">Suas campanhas e mesas</h2>
        </div>
        {mesas === null ? (
          <p className="loading">Carregando…</p>
        ) : mesas.length === 0 ? (
          <div className="empty">Você ainda não conduz nenhuma mesa. Crie uma campanha abaixo e mande o código para o grupo.</div>
        ) : (
          <ul className="list">
            {mesas.map((m) => (
              <li key={m.id} className="camp">
                <div className="camp-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="camp-title">{m.name}</div>
                    <div className="camp-sub">
                      {m.kind === "avulsa" ? "Mesa avulsa" : m.system} · {m.members - 1} {m.members - 1 === 1 ? "jogador" : "jogadores"} · {when(m.last_roll_at)}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    {m.rune_system && <span className="badge amber">Runas</span>}
                    <span className={`badge${m.visibility === "publica" ? " moss" : ""}`}>{m.visibility === "publica" ? "Pública" : "Privada"}</span>
                  </div>
                </div>
                <div className="camp-actions">
                  <CodeBox code={m.code} name={m.name} />
                  <span className="spacer" />
                  <Link className="btn btn-small" href={`/mestre/${m.id}`}>
                    Gerenciar
                  </Link>
                  <Link className="btn btn-primary btn-small" href={`/mesa/${m.code}`}>
                    Abrir mesa
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel section music-cta" aria-labelledby="musicas-titulo">
        <div className="section-head">
          <div>
            <h2 id="musicas-titulo">Músicas</h2>
            <p className="hint">Guarde trilhas do YouTube ou de arquivos de áudio, monte playlists por clima de cena e toque para a mesa inteira.</p>
          </div>
          <Link className="btn" href="/mestre/musicas">
            Abrir músicas
          </Link>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel section" aria-labelledby="nova-campanha">
          <h2 id="nova-campanha">Nova campanha</h2>
          <form className="form" onSubmit={create}>
            <MesaFields value={form} onChange={setForm} />
            <button className="btn btn-primary" type="submit" disabled={creating || !form.name.trim()}>
              {creating ? "Criando…" : "Criar campanha"}
            </button>
          </form>
        </section>
        <section className="panel section" aria-labelledby="mesa-rapida" style={{ alignContent: "start" }}>
          <h2 id="mesa-rapida">Mesa avulsa</h2>
          <p className="hint">Para uma sessão única ou um teste rápido: gera um código na hora e já abre a mesa.</p>
          <label className="field">
            <span>Nome (opcional)</span>
            <input className="input" value={quickName} onChange={(e) => setQuickName(e.target.value)} maxLength={80} placeholder="Ex.: One-shot de sexta" />
          </label>
          <button className="btn" type="button" onClick={() => void createQuick()} disabled={creating}>
            Criar e abrir mesa
          </button>
        </section>
      </div>
    </>
  );
}

export default function MestrePage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Área do Mestre</h1>
        <p>Crie campanhas, convide o grupo pelo código e conduza a mesa: todos veem as rolagens de todos, e as rolagens secretas dos jogadores chegam só para você.</p>
      </div>
      <RequireAccount next="/mestre" allowGuest={false}>
        <MestreArea />
      </RequireAccount>
    </div>
  );
}
