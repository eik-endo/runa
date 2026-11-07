"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

/** Explains what is missing when the site has no Supabase configured. */
export function OfflineNotice() {
  return (
    <div className="notice">
      <b>As mesas online ainda não estão ligadas neste site.</b>
      <span>
        Quem cuida do site precisa conectar o Supabase na Vercel (Storage → Supabase) e publicar de novo. O passo a passo está no README do
        projeto. Enquanto isso, a mesa solo funciona normalmente.
      </span>
      <Link href="/" className="btn btn-small" style={{ justifySelf: "start" }}>
        Ir para a mesa solo
      </Link>
    </div>
  );
}

/** Renders children only for signed-in users; otherwise points to the login page. */
export function RequireAccount({ children, next, allowGuest = true }: { children: React.ReactNode; next: string; allowGuest?: boolean }) {
  const { online, ready, profile, session } = useAuth();
  if (!online) return <OfflineNotice />;
  if (!ready || (session && !profile)) return <p className="loading">Carregando…</p>;
  if (!profile)
    return (
      <div className="empty">
        <span>Entre na sua conta para ver esta área.</span>
        <Link className="btn btn-primary" href={`/entrar?next=${encodeURIComponent(next)}`}>
          Entrar ou criar conta
        </Link>
      </div>
    );
  if (!allowGuest && profile.is_guest)
    return (
      <div className="empty">
        <span>Você está como convidado. Para criar e conduzir mesas, salve sua conta com usuário e senha na área do Jogador.</span>
        <Link className="btn btn-primary" href="/jogador#perfil">
          Salvar minha conta
        </Link>
      </div>
    );
  return <>{children}</>;
}
