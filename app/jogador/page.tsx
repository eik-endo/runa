"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CharacterDialog } from "@/components/CharacterDialog";
import { CustomDiceDialog } from "@/components/CustomDiceDialog";
import { RuneGlyph } from "@/components/glyphs";
import { RequireAccount } from "@/components/OnlineGate";
import { ColorPicker } from "@/components/pickers";
import { SheetList } from "@/components/sheet/SheetList";
import { toast } from "@/components/Toaster";
import {
  type MesaSummary,
  type SavedDie,
  createCustomDie,
  deleteCustomDie,
  errorMessage,
  joinMesa,
  listCustomDice,
  myMesas,
  removeMember,
  updateMyMember,
  updateProfile,
} from "@/lib/api";
import { RUNE_BY_KEY } from "@/lib/dice/runes";

function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const { mesa } = await joinMesa(code);
          router.push(`/mesa/${mesa.code}`);
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <div className="row">
        <input
          className="input code"
          style={{ flex: "1 1 160px", textTransform: "uppercase" }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="CÓDIGO"
          aria-label="Código da mesa"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || code.length < 6}>
          {busy ? "Entrando…" : "Entrar na mesa"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ProfileSection() {
  const { profile, setProfile, signOut, claimGuest } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [color, setColor] = useState(profile?.dice_color ?? "#b8402f");
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  if (!profile) return null;
  return (
    <section className="panel section" id="perfil" aria-labelledby="perfil-titulo">
      <div className="section-head">
        <h2 id="perfil-titulo">Seu perfil</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => void signOut()}>
          Sair da conta
        </button>
      </div>
      <p className="hint">{profile.is_guest ? "Você está como convidado neste aparelho." : `Usuário @${profile.username}`}</p>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const display_name = name.trim().slice(0, 40) || profile.display_name;
            await updateProfile(profile.id, { display_name, dice_color: color });
            setProfile({ ...profile, display_name, dice_color: color });
            toast("Perfil salvo.");
          } catch (err) {
            toast(errorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="field">
          <span>Nome que aparece nas mesas</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <ColorPicker value={color} onChange={setColor} label="Cor padrão dos seus dados" />
        <p className="hint">A cor padrão vale para as mesas em que você entrar daqui para frente. Em cada mesa, dá para trocar no seu personagem.</p>
        <div className="row">
          <span className="spacer" />
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      </form>
      {profile.is_guest && (
        <form
          className="form"
          style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setClaimError(null);
            try {
              await claimGuest(username, password);
              toast("Conta salva. Agora é só entrar com usuário e senha.");
            } catch (err) {
              setClaimError(err instanceof Error ? err.message : "Não foi possível salvar a conta.");
            }
          }}
        >
          <h3>Guardar esta conta</h3>
          <p className="hint">Escolha usuário e senha para manter suas mesas e personagens e entrar de outros aparelhos.</p>
          <div className="grid-2">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuário" autoCapitalize="none" autoComplete="username" />
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" autoComplete="new-password" />
          </div>
          {claimError && (
            <p className="error" role="alert">
              {claimError}
            </p>
          )}
          <button className="btn" type="submit" disabled={!username || password.length < 6}>
            Salvar conta
          </button>
        </form>
      )}
    </section>
  );
}

function JogadorArea() {
  const { profile } = useAuth();
  const [mesas, setMesas] = useState<MesaSummary[] | null>(null);
  const [dice, setDice] = useState<SavedDie[]>([]);
  const [editing, setEditing] = useState<MesaSummary | null>(null);
  const [showDice, setShowDice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([myMesas(), listCustomDice()]);
      setMesas(m.filter((x) => x.role === "jogador"));
      setDice(d.filter((x) => x.mesa_id === null));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <section className="panel section" aria-labelledby="entrar-mesa">
        <h2 id="entrar-mesa">Entrar numa mesa</h2>
        <p className="hint">Digite o código de 6 letras que o mestre passou.</p>
        <JoinByCode />
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel section" aria-labelledby="minhas-mesas">
        <h2 id="minhas-mesas">Suas campanhas como jogador</h2>
        {mesas === null ? (
          <p className="loading">Carregando…</p>
        ) : mesas.length === 0 ? (
          <div className="empty">Quando você entrar numa mesa pelo código, ela aparece aqui com o seu personagem.</div>
        ) : (
          <ul className="list">
            {mesas.map((m) => {
              const rune = m.rune ? RUNE_BY_KEY[m.rune] : null;
              return (
                <li key={m.id} className="camp">
                  <div className="camp-top">
                    <div style={{ minWidth: 0 }}>
                      <div className="camp-title">{m.name}</div>
                      <div className="camp-sub">
                        Mestre: {m.owner_name} · {m.kind === "avulsa" ? "Mesa avulsa" : m.system}
                      </div>
                    </div>
                    <span className="dot" style={{ background: m.color ?? profile?.dice_color, width: 14, height: 14 }} />
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span>{m.character_name ? <b>{m.character_name}</b> : <span className="hint">Personagem sem nome</span>}</span>
                    {rune && (
                      <span className="badge amber" title={rune.meaning}>
                        <RuneGlyph rune={rune} size={14} weight={12} />
                        {rune.name}
                      </span>
                    )}
                  </div>
                  <div className="camp-actions">
                    <button type="button" className="btn btn-small" onClick={() => setEditing(m)}>
                      Personagem
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={async () => {
                        if (!profile || !confirm(`Sair de "${m.name}"? Você pode voltar depois com o código.`)) return;
                        try {
                          await removeMember(m.id, profile.id);
                          await load();
                        } catch (err) {
                          toast(errorMessage(err));
                        }
                      }}
                    >
                      Sair da mesa
                    </button>
                    <span className="spacer" />
                    <Link className="btn btn-primary btn-small" href={`/mesa/${m.code}`}>
                      Abrir mesa
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {profile && <SheetList ownerId={profile.id} />}

      <section className="panel section" aria-labelledby="meus-dados">
        <div className="section-head">
          <h2 id="meus-dados">Seus dados personalizados</h2>
          <button type="button" className="btn btn-small" onClick={() => setShowDice(true)}>
            Gerenciar
          </button>
        </div>
        {dice.length ? (
          <div className="row" style={{ gap: 6 }}>
            {dice.map((d) => (
              <span key={d.id} className="chip">
                {d.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="hint">Crie dados com faces próprias (Sim/Não, clima, tabelas de encontro) e use em qualquer mesa.</p>
        )}
      </section>

      <ProfileSection />

      {editing && profile && (
        <CharacterDialog
          mesaName={editing.name}
          runeSystem={editing.rune_system}
          initial={{
            character_name: editing.character_name,
            character_notes: editing.character_notes,
            rune: editing.rune,
            color: editing.color ?? profile.dice_color,
          }}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            await updateMyMember(editing.id, profile.id, v);
            toast("Personagem salvo.");
            await load();
          }}
        />
      )}
      {showDice && (
        <CustomDiceDialog
          dice={dice.map((d) => d.spec)}
          intro="Seus dados aparecem para você em todas as mesas."
          onClose={() => setShowDice(false)}
          onCreate={async ({ name, die }) => {
            const saved = await createCustomDie(name, die, null);
            setDice((list) => [...list, saved]);
          }}
          onDelete={async (d) => {
            if (!d.id) return;
            await deleteCustomDie(d.id);
            setDice((list) => list.filter((x) => x.id !== d.id));
          }}
        />
      )}
    </>
  );
}

export default function JogadorPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Área do Jogador</h1>
        <p>Entre nas mesas pelo código, cuide das suas fichas e do seu personagem em cada campanha e guarde seus dados personalizados.</p>
      </div>
      <RequireAccount next="/jogador">
        <JogadorArea />
      </RequireAccount>
    </div>
  );
}
