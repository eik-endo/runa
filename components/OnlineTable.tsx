"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type MesaState,
  type PresenceUser,
  type Profile,
  type SavedDie,
  createCustomDie,
  deleteCustomDie,
  errorMessage,
  joinMesa,
  listCustomDice,
  mesaState,
  recentRolls,
  rollAtMesa,
  subscribeMesa,
  updateMyMember,
} from "@/lib/api";
import type { RollRecord, RollRequest } from "@/lib/dice/types";
import { useAuth } from "./AuthProvider";
import { CharacterDialog } from "./CharacterDialog";
import { CodeBox } from "./CodeBox";
import { CustomDiceDialog } from "./CustomDiceDialog";
import { type TrayHandle, DiceTrayView } from "./DiceTrayView";
import { Icon } from "./glyphs";
import { OfflineNotice } from "./OnlineGate";
import { RollLog } from "./RollLog";
import { Roller } from "./Roller";
import { toast } from "./Toaster";

const MAX_LOG = 120;

function GuestJoin({ code }: { code: string }) {
  const { enterAsGuest } = useAuth();
  const [nick, setNick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Mesa {code}</h1>
        <p>Você foi chamado para jogar. Entre com um apelido ou com a sua conta.</p>
      </div>
      <section className="panel section">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await enterAsGuest(nick);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Não foi possível entrar.");
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Seu apelido na mesa</span>
            <input className="input" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={40} placeholder="Ex.: Bjorn" autoFocus />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || nick.trim().length < 2}>
            {busy ? "Entrando…" : "Entrar como convidado"}
          </button>
        </form>
        <p className="hint">
          Já tem conta?{" "}
          <Link href={`/entrar?next=${encodeURIComponent(`/mesa/${code}`)}`} style={{ color: "var(--amber)" }}>
            Entre com usuário e senha
          </Link>{" "}
          para guardar seu personagem nesta mesa.
        </p>
      </section>
    </div>
  );
}

function sortRolls(list: RollRecord[]) {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_LOG);
}

function Mesa({ code, me }: { code: string; me: Profile }) {
  const tray = useRef<TrayHandle>(null);
  const [state, setState] = useState<MesaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolls, setRolls] = useState<RollRecord[]>([]);
  const [dice, setDice] = useState<SavedDie[]>([]);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [live, setLive] = useState<"online" | "offline" | "connecting">("connecting");
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showChar, setShowChar] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const seen = useRef(new Set<string>());
  const presence = useRef<{ updatePresence(p: PresenceUser): void } | null>(null);
  const mesaId = state?.mesa.id;

  const addRoll = useCallback((r: RollRecord) => setRolls((list) => (list.some((x) => x.id === r.id) ? list : sortRolls([r, ...list]))), []);

  const reloadState = useCallback(async (id: string) => {
    try {
      setState(await mesaState(id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const reloadDice = useCallback(async (id: string) => {
    try {
      setDice((await listCustomDice()).filter((d) => d.mesa_id === id || (d.mesa_id === null && d.owner_id === me.id)));
    } catch {
      /* keep the dice we have */
    }
  }, [me.id]);

  // join by code, then load everything
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { mesa } = await joinMesa(code);
        if (!alive) return;
        const [st, rs] = await Promise.all([mesaState(mesa.id), recentRolls(mesa.id)]);
        if (!alive) return;
        rs.forEach((r) => seen.current.add(r.id));
        setState(st);
        setRolls(rs);
        void reloadDice(mesa.id);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, reloadDice]);

  const myMember = state?.members.find((m) => m.user_id === me.id);
  const myName = myMember?.character_name || me.display_name;
  const myColor = myMember?.color || me.dice_color;

  // live updates
  useEffect(() => {
    if (!mesaId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = subscribeMesa(
      mesaId,
      { user_id: me.id, name: myName, color: myColor },
      {
        onRoll(record) {
          if (seen.current.has(record.id)) return;
          seen.current.add(record.id);
          if (document.hidden) addRoll(record);
          else void tray.current?.play(record).then(() => addRoll(record));
        },
        onMembersChanged() {
          clearTimeout(timer);
          timer = setTimeout(() => void reloadState(mesaId), 400);
        },
        onDiceChanged() {
          void reloadDice(mesaId);
        },
        onPresence: setOnline,
        onStatus: setLive,
      },
    );
    presence.current = sub;
    return () => {
      clearTimeout(timer);
      sub.unsubscribe();
      presence.current = null;
    };
    // presence details are updated separately; resubscribe only when the table changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesaId, me.id, addRoll, reloadState, reloadDice]);

  useEffect(() => {
    presence.current?.updatePresence({ user_id: me.id, name: myName, color: myColor });
  }, [me.id, myName, myColor]);

  const roll = useCallback(
    async (req: RollRequest) => {
      if (!mesaId) return;
      tray.current?.unlockAudio();
      setBusy(true);
      let record: RollRecord;
      try {
        record = await rollAtMesa(mesaId, req, secret);
      } catch (e) {
        toast(errorMessage(e));
        setBusy(false);
        return;
      }
      setBusy(false);
      seen.current.add(record.id);
      await tray.current?.play(record);
      addRoll(record);
    },
    [mesaId, secret, addRoll],
  );

  const repeat = useCallback(
    (r: RollRecord) => void roll({ groups: r.groups.map(({ values: _v, ...g }) => g), modifier: r.modifier, notation: r.notation, label: r.label ?? undefined }),
    [roll],
  );

  const onlineIds = useMemo(() => new Set(online.map((u) => u.user_id)), [online]);
  const customSpecs = useMemo(() => dice.map((d) => d.spec), [dice]);

  if (error && !state)
    return (
      <div className="page page-narrow">
        <div className="empty">
          <span>{error}</span>
          <Link className="btn" href="/jogador">
            Digitar outro código
          </Link>
        </div>
      </div>
    );
  if (!state) return <p className="loading">Entrando na mesa…</p>;

  const isMaster = state.role === "mestre";
  const masterName = state.members.find((m) => m.role === "mestre")?.display_name;

  return (
    <div className="table-layout">
      <div className="table-main">
        <DiceTrayView ref={tray} showWho emptyHint="Quando alguém rolar, os dados caem aqui para todo mundo ver." />
        <Roller
          customDice={customSpecs}
          onRoll={roll}
          busy={busy}
          onManageCustom={() => setShowDice(true)}
          extra={
            <label className="check" title={isMaster ? "Só você vê" : "Só você e o mestre veem"}>
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
              <Icon name="lock" size={16} />
              {isMaster ? "Escondida dos jogadores" : "Secreta (só o mestre vê)"}
            </label>
          }
        />
      </div>
      <aside className="table-side">
        <div className="panel mesa-panel">
          <div className="mesa-panel-top">
            <div style={{ minWidth: 0 }}>
              <div className="mesa-name">{state.mesa.name}</div>
              <div className="hint">
                {isMaster ? "Você é o mestre" : `Mestre: ${masterName ?? "—"}`} ·{" "}
                <span style={{ color: live === "online" ? "var(--moss)" : "var(--amber)" }}>
                  {live === "online" ? "ao vivo" : live === "connecting" ? "conectando…" : "reconectando…"}
                </span>
              </div>
            </div>
            <CodeBox code={state.mesa.code} name={state.mesa.name} compact />
          </div>
          <div className="mesa-panel-bottom">
            <div className="presence" aria-label="Quem está na mesa">
              {state.members.map((m) => {
                const on = onlineIds.has(m.user_id);
                return (
                  <span key={m.user_id} className={`member-chip${on ? " on" : ""}`} title={on ? "Na mesa agora" : "Fora da mesa"}>
                    <span className="dot" style={{ background: m.color }} />
                    {m.character_name || m.display_name}
                    {m.role === "mestre" && <span className="sr-only"> (mestre)</span>}
                    {m.role === "mestre" && <span className="crown" aria-hidden="true">mestre</span>}
                  </span>
                );
              })}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-small" onClick={() => setShowChar(true)}>
                {isMaster ? "Minha cor" : "Meu personagem"}
              </button>
              {isMaster && (
                <Link className="btn btn-small" href={`/mestre/${state.mesa.id}`}>
                  Gerenciar
                </Link>
              )}
            </div>
          </div>
        </div>
        <RollLog records={rolls} showWho onRepeat={repeat} emptyText="Ninguém rolou ainda nesta mesa." />
      </aside>

      {showChar && myMember && (
        <CharacterDialog
          mesaName={state.mesa.name}
          runeSystem={state.mesa.rune_system && !isMaster}
          initial={{ character_name: myMember.character_name, character_notes: myMember.character_notes, rune: myMember.rune, color: myMember.color }}
          onClose={() => setShowChar(false)}
          onSave={async (v) => {
            await updateMyMember(state.mesa.id, me.id, v);
            await reloadState(state.mesa.id);
            toast("Personagem salvo.");
          }}
        />
      )}
      {showDice && (
        <CustomDiceDialog
          dice={customSpecs}
          showShareOption={isMaster}
          intro={isMaster ? "Marque “Disponível para todos na mesa” para o grupo inteiro usar o dado." : "Seus dados aparecem para você em todas as mesas."}
          tag={(d) => (dice.find((x) => x.id === d.id)?.mesa_id ? "da mesa" : null)}
          canDelete={(d) => {
            const saved = dice.find((x) => x.id === d.id);
            return !!saved && (saved.owner_id === me.id || isMaster);
          }}
          onClose={() => setShowDice(false)}
          onCreate={async ({ name, die, shared }) => {
            const saved = await createCustomDie(name, die, shared && isMaster ? state.mesa.id : null);
            setDice((list) => [...list, saved]);
          }}
          onDelete={async (d) => {
            if (!d.id) return;
            try {
              await deleteCustomDie(d.id);
              setDice((list) => list.filter((x) => x.id !== d.id));
            } catch (e) {
              toast(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

export function OnlineTable({ code }: { code: string }) {
  const { online, ready, session, profile } = useAuth();
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (!online)
    return (
      <div className="page page-narrow">
        <OfflineNotice />
      </div>
    );
  if (!ready || (session && !profile)) return <p className="loading">Carregando…</p>;
  if (!profile) return <GuestJoin code={clean} />;
  return <Mesa code={clean} me={profile} />;
}
