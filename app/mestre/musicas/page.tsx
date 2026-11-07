"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { MusicDock } from "@/components/music/MusicDock";
import { MusicManager } from "@/components/music/MusicManager";
import { RequireAccount } from "@/components/OnlineGate";
import { type Canal, type SomAcao, type SomState, applyLocal } from "@/lib/music";

function Musicas() {
  const { profile } = useAuth();
  const [states, setStates] = useState<Partial<Record<Canal, SomState | null>>>({});
  // the same rules as at the table, but only on this device
  const control = useCallback(async (canal: Canal, acao: SomAcao, dados?: Record<string, unknown>) => {
    setStates((s) => ({ ...s, [canal]: applyLocal(s[canal] ?? null, canal, acao, dados) }));
  }, []);
  if (!profile) return null;
  return (
    <div className="music-page">
      <section className="panel section">
        <MusicManager ownerId={profile.id} control={control} playing={states} />
      </section>
      <aside className="panel section music-page-side">
        <h2>Ouvir aqui</h2>
        <p className="hint">
          Nesta página a música toca só para você, para testar. Na mesa, o mesmo botão toca para todos os jogadores ao mesmo tempo.
        </p>
        <MusicDock states={states} skewMs={0} master control={control} />
        {!states.musica?.faixa && !states.ambiente?.faixa && <div className="empty">Nada tocando. Use ▶ numa música ou playlist.</div>}
      </aside>
    </div>
  );
}

export default function MusicasPage() {
  return (
    <div className="page page-wide">
      <Link href="/mestre" className="hint">
        ← Área do Mestre
      </Link>
      <div className="page-head">
        <h1>Músicas</h1>
        <p>Guarde trilhas por link e monte playlists por clima de cena. Na mesa, você toca para o grupo inteiro e cada jogador ajusta o próprio volume.</p>
      </div>
      <RequireAccount next="/mestre/musicas" allowGuest={false}>
        <Musicas />
      </RequireAccount>
    </div>
  );
}
