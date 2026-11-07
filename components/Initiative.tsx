"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Combate, type Combatente, addCombatant, combatState, controlCombat, errorMessage, joinInitiative, removeCombatant, updateCombatant } from "@/lib/api";
import { summarize } from "@/lib/dice/summary";
import type { RollRecord } from "@/lib/dice/types";
import { signed } from "@/lib/sheet";
import { Icon } from "./glyphs";
import { toast } from "./Toaster";

const ESTADO: Record<string, string> = { ileso: "Ileso", ferido: "Ferido", "muito ferido": "Muito ferido", caido: "Caído" };

function HpEditor({ c, onSave }: { c: Combatente; onSave: (patch: Partial<Combatente>) => void }) {
  const [amount, setAmount] = useState("1");
  const n = Math.max(1, parseInt(amount, 10) || 1);
  return (
    <span className="hp-edit">
      <button type="button" className="icon-btn small" title={`Tirar ${n} PV`} aria-label={`Tirar ${n} pontos de vida de ${c.nome}`} onClick={() => onSave({ pv: (c.pv ?? 0) - n })}>
        −
      </button>
      <input className="input num tiny" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Quantidade de PV" />
      <button
        type="button"
        className="icon-btn small"
        title={`Curar ${n} PV`}
        aria-label={`Curar ${n} pontos de vida de ${c.nome}`}
        onClick={() => onSave({ pv: Math.min(c.pv_max ?? 99999, (c.pv ?? 0) + n) })}
      >
        +
      </button>
    </span>
  );
}

/**
 * Turn order. The game master adds creatures and runs the turns; players roll
 * their own initiative from here (the roll goes to the table like any other).
 */
export function Initiative({
  mesaId,
  meId,
  master,
  version,
  initBonus,
  rollD20,
}: {
  mesaId: string;
  meId: string;
  master: boolean;
  /** Bumped by realtime when the combat changes. */
  version: number;
  /** Initiative bonus from the player's sheet, if they have one. */
  initBonus: number | null;
  rollD20: (notation: string, label: string, secret?: boolean) => Promise<RollRecord | null>;
}) {
  const [c, setC] = useState<Combate | null>(null);
  const [form, setForm] = useState({ nome: "", bonus: "0", qtd: "1", pv: "", ca: "", oculto: true });
  const [bonus, setBonus] = useState<string>(initBonus !== null ? String(initBonus) : "0");
  const [busy, setBusy] = useState(false);
  const lastTurn = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setC(await combatState(mesaId));
    } catch (e) {
      toast(errorMessage(e));
    }
  }, [mesaId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    if (initBonus !== null) setBonus(String(initBonus));
  }, [initBonus]);

  // "your turn" for players
  useEffect(() => {
    if (!c?.ativo || !c.turno || c.turno === lastTurn.current) return;
    lastTurn.current = c.turno;
    const cur = c.combatentes.find((x) => x.id === c.turno);
    if (cur && cur.user_id === meId && !master) toast(`Sua vez, ${cur.nome}!`);
  }, [c, meId, master]);

  const run = async (fn: () => Promise<Combate | void>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) setC(r);
      else await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rollMine = async () => {
    const b = parseInt(bonus, 10) || 0;
    const rec = await rollD20(b ? `1d20${b > 0 ? "+" : "-"}${Math.abs(b)}` : "1d20", "Iniciativa");
    if (!rec) return;
    const total = summarize(rec.groups, rec.modifier).total ?? 0;
    await run(() => joinInitiative(mesaId, total, b));
  };

  const addCreatures = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = form.nome.trim();
    if (!nome) return;
    const qtd = Math.max(1, Math.min(12, parseInt(form.qtd, 10) || 1));
    const b = Math.max(-20, Math.min(20, parseInt(form.bonus, 10) || 0));
    const pv = form.pv.trim() ? Math.max(0, parseInt(form.pv, 10) || 0) : null;
    const ca = form.ca.trim() ? Math.max(0, parseInt(form.ca, 10) || 0) : null;
    const rec = await rollD20(`${qtd}d20`, `Iniciativa: ${nome}${qtd > 1 ? ` ×${qtd}` : ""}`, true);
    if (!rec) return;
    const values = rec.groups[0]?.values ?? [];
    await run(async () => {
      for (let i = 0; i < qtd; i++) {
        await addCombatant(mesaId, {
          nome: qtd > 1 ? `${nome} ${i + 1}` : nome,
          iniciativa: (values[i] ?? 10) + b,
          desempate: b,
          pv,
          pv_max: pv,
          ca,
          oculto: form.oculto,
        });
      }
    });
    setForm((f) => ({ ...f, nome: "", qtd: "1" }));
  };

  if (!c) return <p className="loading">Carregando iniciativa…</p>;
  const mine = c.combatentes.find((x) => x.user_id === meId);

  return (
    <div className="initiative">
      <div className="init-head">
        <div>
          <b>{c.ativo ? `Rodada ${c.rodada}` : "Fora de combate"}</b>
          <div className="hint">{c.combatentes.length ? `${c.combatentes.length} na ordem` : "Ninguém na ordem ainda."}</div>
        </div>
        {master && (
          <div className="row" style={{ gap: 6 }}>
            {!c.ativo ? (
              <button type="button" className="btn btn-primary btn-small" disabled={busy || !c.combatentes.length} onClick={() => void run(() => controlCombat(mesaId, "iniciar"))}>
                Começar combate
              </button>
            ) : (
              <>
                <button type="button" className="icon-btn" title="Turno anterior" aria-label="Turno anterior" disabled={busy} onClick={() => void run(() => controlCombat(mesaId, "anterior"))}>
                  <Icon name="prev" size={16} />
                </button>
                <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void run(() => controlCombat(mesaId, "proximo"))}>
                  Próximo turno
                </button>
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(() => controlCombat(mesaId, "encerrar"))}>
                  Encerrar
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!master && (
        <div className="init-me">
          <label className="field" style={{ width: 96 }}>
            <span>Seu bônus</span>
            <input className="input num" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^\d-]/g, "").slice(0, 3))} aria-label="Bônus de iniciativa" />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void rollMine()}>
            {mine ? "Rolar de novo" : "Rolar minha iniciativa"}
          </button>
          {initBonus !== null && <span className="hint">Bônus da sua ficha: {signed(initBonus)}</span>}
        </div>
      )}

      {c.combatentes.length > 0 && (
        <ol className="init-list">
          {c.combatentes.map((x) => {
            const turn = c.ativo && c.turno === x.id;
            const showHp = x.pv !== null && x.pv_max !== null;
            const pct = showHp && x.pv_max ? Math.max(0, Math.min(1, (x.pv ?? 0) / x.pv_max)) : 0;
            return (
              <li key={x.id} className={`init-row${turn ? " turn" : ""}${x.user_id === meId ? " me" : ""}${x.estado === "caido" ? " down" : ""}`}>
                {master ? (
                  <input
                    className="input num tiny init-value"
                    defaultValue={x.iniciativa}
                    key={`${x.id}-${x.iniciativa}`}
                    aria-label={`Iniciativa de ${x.nome}`}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v !== x.iniciativa) void run(() => updateCombatant(x.id, { iniciativa: Math.max(-50, Math.min(100, v)) }));
                    }}
                  />
                ) : (
                  <span className="init-value">{x.iniciativa}</span>
                )}
                <span className="dot" style={{ background: x.cor ?? "var(--wool-faint)" }} />
                <div className="init-main">
                  <span className="init-name">
                    {x.nome}
                    {turn && <span className="badge amber">vez</span>}
                  </span>
                  {showHp ? (
                    <span className="init-hp">
                      <span className="hp-bar small" aria-hidden="true">
                        <span style={{ width: `${pct * 100}%`, background: pct > 0.5 ? "var(--moss)" : pct > 0.25 ? "var(--amber)" : "var(--madder)" }} />
                      </span>
                      <span className="hint">
                        {x.pv}/{x.pv_max} PV
                      </span>
                      {x.ca !== null && <span className="hint">CA {x.ca}</span>}
                    </span>
                  ) : x.estado ? (
                    <span className="hint">{ESTADO[x.estado]}</span>
                  ) : null}
                </div>
                {master && (
                  <div className="init-actions">
                    {showHp && <HpEditor c={x} onSave={(patch) => void run(() => updateCombatant(x.id, patch))} />}
                    {x.user_id === null && (
                      <button
                        type="button"
                        className="icon-btn small"
                        title={x.oculto ? "PV escondidos dos jogadores" : "PV visíveis para os jogadores"}
                        aria-label={x.oculto ? `Mostrar PV de ${x.nome}` : `Esconder PV de ${x.nome}`}
                        onClick={() => void run(() => updateCombatant(x.id, { oculto: !x.oculto }))}
                      >
                        <Icon name={x.oculto ? "eyeOff" : "eye"} size={16} />
                      </button>
                    )}
                    <button type="button" className="icon-btn small" aria-label={`Tirar ${x.nome} da ordem`} title="Tirar da ordem" onClick={() => void run(() => removeCombatant(x.id))}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {master && (
        <form className="init-add" onSubmit={(e) => void addCreatures(e)}>
          <h4>Adicionar criaturas</h4>
          <div className="init-add-grid">
            <label className="field">
              <span>Nome</span>
              <input className="input" value={form.nome} maxLength={50} placeholder="Draugr" onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </label>
            <label className="field">
              <span>Qtd.</span>
              <input className="input num" value={form.qtd} onChange={(e) => setForm({ ...form, qtd: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            </label>
            <label className="field">
              <span>Bônus</span>
              <input className="input num" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value.replace(/[^\d-]/g, "").slice(0, 3) })} />
            </label>
            <label className="field">
              <span>PV</span>
              <input className="input num" value={form.pv} onChange={(e) => setForm({ ...form, pv: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
            </label>
            <label className="field">
              <span>CA</span>
              <input className="input num" value={form.ca} onChange={(e) => setForm({ ...form, ca: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={form.oculto} onChange={(e) => setForm({ ...form, oculto: e.target.checked })} />
              Esconder PV dos jogadores
            </label>
            <span className="spacer" />
            <button className="btn btn-primary btn-small" type="submit" disabled={busy || !form.nome.trim()}>
              Rolar e adicionar
            </button>
          </div>
          <p className="hint">A iniciativa das criaturas é rolada escondida dos jogadores. Os jogadores rolam a deles nesta mesma aba.</p>
          {c.combatentes.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                if (confirm("Tirar todos da ordem de iniciativa?")) void run(() => controlCombat(mesaId, "limpar"));
              }}
            >
              Limpar a ordem
            </button>
          )}
        </form>
      )}
    </div>
  );
}
