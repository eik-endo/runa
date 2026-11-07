"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { OfflineNotice } from "@/components/OnlineGate";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/jogador";
  return raw;
}

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const router = useRouter();
  const { online, profile, ready, signIn, signUp } = useAuth();
  const [tab, setTab] = useState<"entrar" | "criar">(params.get("criar") ? "criar" : "entrar");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && profile && !profile.is_guest) router.replace(next);
  }, [ready, profile, next, router]);

  if (!online)
    return (
      <div className="page page-narrow">
        <OfflineNotice />
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "entrar") await signIn(username, password);
      else await signUp(username, password, displayName || username);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>{tab === "entrar" ? "Entrar" : "Criar conta"}</h1>
        <p>Com uma conta você cria mesas como mestre, entra nas mesas dos amigos e guarda seus personagens e dados.</p>
      </div>
      <section className="panel section">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "entrar"} onClick={() => setTab("entrar")}>
            Já tenho conta
          </button>
          <button type="button" role="tab" aria-selected={tab === "criar"} onClick={() => setTab("criar")}>
            Criar conta
          </button>
        </div>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Nome de usuário</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="ex.: bjorn_ferro"
            />
          </label>
          {tab === "criar" && (
            <label className="field">
              <span>Como você quer aparecer na mesa</span>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} placeholder="ex.: Bjorn" />
            </label>
          )}
          <label className="field">
            <span>Senha</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "entrar" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>
          {tab === "criar" && <p className="hint">Usuário com 3 a 24 caracteres: letras, números, ponto, hífen ou _. Senha com pelo menos 6 caracteres.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : tab === "entrar" ? "Entrar" : "Criar conta e entrar"}
          </button>
        </form>
      </section>
      <p className="hint">Vai só jogar hoje? Abra o link da mesa que o mestre mandou: dá para entrar como convidado, só com um apelido.</p>
    </div>
  );
}

export default function EntrarPage() {
  return (
    <Suspense fallback={<p className="loading">Carregando…</p>}>
      <LoginForm />
    </Suspense>
  );
}
