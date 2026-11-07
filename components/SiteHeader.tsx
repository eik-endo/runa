"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { Logo } from "./glyphs";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function SiteHeader() {
  const path = usePathname() ?? "/";
  const { online, profile, ready } = useAuth();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined;
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Runa, início">
        <Logo />
        <span>Runa</span>
      </Link>
      <nav className="nav" aria-label="Principal">
        <Link href="/" aria-current={current("/")}>
          Rolar
        </Link>
        <Link href="/mestre" aria-current={current("/mestre")}>
          Mestre
        </Link>
        <Link href="/jogador" aria-current={current("/jogador")}>
          Jogador
        </Link>
        {online && ready && !profile && (
          <Link href="/entrar" aria-current={current("/entrar")}>
            Entrar
          </Link>
        )}
        {profile && (
          <Link href="/jogador#perfil" title={`${profile.display_name} (@${profile.username})`} style={{ padding: 4 }}>
            <span className="avatar" style={{ background: profile.dice_color, color: "#fff8ef" }}>
              {initials(profile.display_name)}
            </span>
          </Link>
        )}
      </nav>
    </header>
  );
}
