"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CodeBox } from "@/components/CodeBox";
import { CustomDiceDialog } from "@/components/CustomDiceDialog";
import { RuneGlyph } from "@/components/glyphs";
import { MesaFields, type MesaFormValue } from "@/components/MesaForm";
import { RequireAccount } from "@/components/OnlineGate";
import { toast } from "@/components/Toaster";
import {
  type MesaState,
  type SavedDie,
  clearRolls,
  createCustomDie,
  deleteCustomDie,
  deleteMesa,
  errorMessage,
  listCustomDice,
  mesaState,
  regenerateCode,
  removeMember,
  updateMesa,
} from "@/lib/api";
import { RUNE_BY_KEY } from "@/lib/dice/runes";

function Manage({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<MesaState | null>(null);
  const [form, setForm] = useState<MesaFormValue | null>(null);
  const [dice, setDice] = useState<SavedDie[]>([]);
  const [showDice, setShowDice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await mesaState(id);
      setState(s);
      setForm((f) => f ?? { name: s.mesa.name, system: s.mesa.system, description: s.mesa.description, runeSystem: s.mesa.rune_system, visibility: s.mesa.visibility ?? "privada" });
      setDice((await listCustomDice()).filter((d) => d.mesa_id === id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !state)
    return (
      <div className="empty">
        <span>{error}</span>
        <Link className="btn" href="/mestre">
          Voltar para a área do Mestre
        </Link>
      </div>
    );
  if (!state || !form) return <p className="loading">Carregando…</p>;
  if (state.role !== "mestre")
    return (
      <div className="empty">
        <span>Só o mestre desta mesa pode gerenciá-la.</span>
        <Link className="btn btn-primary" href={`/mesa/${state.mesa.code}`}>
          Abrir a mesa
        </Link>
      </div>
    );

  const players = state.members.filter((m) => m.role !== "mestre");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateMesa(id, {
        name: form.name.trim() || state.mesa.name,
        system: form.system.trim() || "Outro",
        description: form.description,
        rune_system: form.runeSystem,
        visibility: form.visibility,
      });
      toast("Campanha salva.");
      await load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{state.mesa.name}</h1>
        <p>
          {state.mesa.kind === "avulsa" ? "Mesa avulsa" : state.mesa.system} · {players.length} {players.length === 1 ? "jogador" : "jogadores"}
        </p>
      </div>

      <section className="panel section">
        <div className="section-head">
          <h2>Convite</h2>
          <Link className="btn btn-primary" href={`/mesa/${state.mesa.code}`}>
            Abrir mesa
          </Link>
        </div>
        <p className="hint">Mande o link ou o código para o grupo. Quem não tem conta entra como convidado, só com um apelido.</p>
        <div className="row">
          <CodeBox code={state.mesa.code} name={state.mesa.name} />
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={async () => {
              if (!confirm("Trocar o código? O código antigo deixa de funcionar para quem ainda não entrou.")) return;
              try {
                await regenerateCode(id);
                await load();
                toast("Código trocado.");
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          >
            Trocar código
          </button>
        </div>
      </section>

      <section className="panel section">
        <h2>Jogadores</h2>
        {players.length === 0 ? (
          <div className="empty">Ninguém entrou ainda. Assim que alguém usar o código, aparece aqui.</div>
        ) : (
          <div>
            {players.map((m) => (
              <div key={m.user_id} className="member">
                <span className="dot" style={{ background: m.color, width: 14, height: 14 }} />
                <div className="member-info">
                  <b>{m.character_name || m.display_name}</b>
                  <span>
                    {m.character_name ? `${m.display_name} · ` : ""}
                    {m.is_guest ? "convidado" : `@${m.username}`}
                  </span>
                </div>
                {m.rune && RUNE_BY_KEY[m.rune] && (
                  <span className="badge amber" title={RUNE_BY_KEY[m.rune].meaning}>
                    <RuneGlyph rune={m.rune} size={14} weight={12} />
                    {RUNE_BY_KEY[m.rune].name}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={async () => {
                    if (!confirm(`Remover ${m.character_name || m.display_name} da mesa?`)) return;
                    try {
                      await removeMember(id, m.user_id);
                      await load();
                    } catch (err) {
                      toast(errorMessage(err));
                    }
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel section">
        <h2>Dados e detalhes</h2>
        <form className="form" onSubmit={save}>
          <MesaFields value={form} onChange={setForm} />
          <div className="row">
            <button type="button" className="btn" onClick={() => setShowDice(true)}>
              Dados da mesa ({dice.length})
            </button>
            <span className="spacer" />
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel section">
        <h2>Limpeza</h2>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (!confirm("Apagar todo o histórico de rolagens desta mesa?")) return;
              try {
                await clearRolls(id);
                toast("Histórico apagado.");
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          >
            Apagar histórico de rolagens
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!confirm(`Apagar "${state.mesa.name}" para sempre? Jogadores, rolagens e dados da mesa somem junto.`)) return;
              try {
                await deleteMesa(id);
                router.replace("/mestre");
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          >
            Apagar mesa
          </button>
        </div>
      </section>

      {showDice && (
        <CustomDiceDialog
          dice={dice.map((d) => d.spec)}
          intro="Dados criados aqui aparecem para todos que estão nesta mesa."
          onClose={() => setShowDice(false)}
          onCreate={async ({ name, die }) => {
            const saved = await createCustomDie(name, die, id);
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

export default function ManagePage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="page">
      <Link href="/mestre" className="hint">
        ← Área do Mestre
      </Link>
      <RequireAccount next={`/mestre/${params.id}`} allowGuest={false}>
        <Manage id={params.id} />
      </RequireAccount>
    </div>
  );
}
