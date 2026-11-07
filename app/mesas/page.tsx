"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Icon } from "@/components/glyphs";
import { OfflineNotice } from "@/components/OnlineGate";
import { type MesaListing, browseMesas, errorMessage } from "@/lib/api";

type Filter = "todas" | "publica" | "privada" | "minhas";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "publica", label: "Públicas" },
  { key: "privada", label: "Privadas" },
  { key: "minhas", label: "Minhas" },
];

const PAGE = 30;

function when(iso: string | null, created: string) {
  const ref = iso ?? created;
  const diff = (Date.now() - new Date(ref).getTime()) / 1000;
  const prefix = iso ? "rolou" : "criada";
  if (diff < 3600) return `${prefix} há ${Math.max(1, Math.floor(diff / 60))} min`;
  if (diff < 86400) return `${prefix} há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `${prefix} há ${Math.floor(diff / 86400)} dias`;
  return `${prefix} em ${new Date(ref).toLocaleDateString("pt-BR")}`;
}

function PrivateJoin() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  if (!open)
    return (
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        <Icon name="lock" size={14} /> Tenho o código
      </button>
    );
  return (
    <form
      className="row"
      style={{ gap: 6, flexWrap: "nowrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) router.push(`/mesa/${code}`);
      }}
    >
      <input
        className="input code"
        style={{ width: 130 }}
        autoFocus
        value={code}
        placeholder="CÓDIGO"
        aria-label="Código da mesa"
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
      />
      <button className="btn btn-primary btn-small" type="submit" disabled={code.length < 6}>
        Entrar
      </button>
    </form>
  );
}

function Card({ m }: { m: MesaListing }) {
  const players = Math.max(0, m.members - 1);
  return (
    <li className="camp mesa-card">
      <div className="camp-top">
        <div style={{ minWidth: 0 }}>
          <div className="camp-title">{m.name}</div>
          <div className="camp-sub">
            {m.kind === "avulsa" ? "Mesa avulsa" : m.system} · mestre {m.owner_name} · {players} {players === 1 ? "jogador" : "jogadores"}
          </div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
          {m.rune_system && <span className="badge amber">Runas</span>}
          <span className={`badge${m.visibility === "publica" ? " moss" : ""}`}>{m.visibility === "publica" ? "Pública" : "Privada"}</span>
        </div>
      </div>
      {m.description ? <p className="mesa-desc">{m.description}</p> : m.visibility === "privada" && !m.my_role ? <p className="hint">Só entra quem tem o código do mestre.</p> : null}
      <div className="camp-actions">
        <span className="hint">{when(m.last_roll_at, m.created_at)}</span>
        <span className="spacer" />
        {m.my_role === "mestre" && (
          <Link className="btn btn-small" href={`/mestre/${m.id}`}>
            Gerenciar
          </Link>
        )}
        {m.my_role ? (
          <Link className="btn btn-primary btn-small" href={`/mesa/${m.code}`}>
            Abrir mesa
          </Link>
        ) : m.code ? (
          <Link className="btn btn-primary btn-small" href={`/mesa/${m.code}`}>
            Entrar
          </Link>
        ) : (
          <PrivateJoin />
        )}
      </div>
    </li>
  );
}

function Browser() {
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const [list, setList] = useState<MesaListing[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(async (q: string, f: Filter, offset: number) => {
    const id = ++req.current;
    setLoading(true);
    try {
      const rows = await browseMesas(q, f, offset, PAGE);
      if (id !== req.current) return;
      setList((prev) => (offset ? [...(prev ?? []), ...rows] : rows));
      setMore(rows.length === PAGE);
      setError(null);
    } catch (e) {
      if (id === req.current) setError(errorMessage(e));
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(query, filter, 0), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, filter, load]);

  const filters = profile ? FILTERS : FILTERS.filter((f) => f.key !== "minhas");

  return (
    <>
      <div className="browse-bar">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar por nome, sistema ou mestre"
            aria-label="Procurar mesas"
          />
        </label>
        <div className="seg" role="group" aria-label="Filtro">
          {filters.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list === null ? (
        <p className="loading">Procurando mesas…</p>
      ) : list.length === 0 ? (
        <div className="empty">
          {query ? `Nenhuma mesa encontrada para “${query}”.` : filter === "minhas" ? "Você ainda não está em nenhuma mesa." : "Nenhuma mesa por aqui ainda."}
          <Link className="btn btn-primary btn-small" href="/mestre">
            Criar uma mesa
          </Link>
        </div>
      ) : (
        <>
          <ul className="mesa-grid">
            {list.map((m) => (
              <Card key={m.id} m={m} />
            ))}
          </ul>
          {more && (
            <button type="button" className="btn" disabled={loading} onClick={() => void load(query, filter, list.length)} style={{ justifySelf: "center" }}>
              {loading ? "Carregando…" : "Mostrar mais"}
            </button>
          )}
        </>
      )}
    </>
  );
}

export default function MesasPage() {
  const { online } = useAuth();
  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>Procurar mesas</h1>
        <p>Todas as mesas do Runa aparecem aqui. Nas públicas, qualquer pessoa entra direto. Nas privadas, só quem tem o código do mestre.</p>
      </div>
      {online ? <Browser /> : <OfflineNotice />}
    </div>
  );
}
