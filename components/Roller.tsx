"use client";

import { useMemo, useState } from "react";
import { NotationError, dieToken, parseNotation, toNotation } from "@/lib/dice/notation";
import { type DiceGroup, type DieSpec, type RollRequest, MAX_DICE, RUNE_DIE, dieLabel, stdDie } from "@/lib/dice/types";
import { DieIcon, Icon } from "./glyphs";

const STANDARD: DieSpec[] = [2, 4, 6, 8, 10, 12, 20, 100].map((n) => stdDie(n));

type Mode = "normal" | "adv" | "dis";

export interface RollerProps {
  customDice: DieSpec[];
  onRoll: (req: RollRequest) => void | Promise<void>;
  onManageCustom?: () => void;
  busy?: boolean;
  /** Extra controls shown next to the label field (e.g. secret roll). */
  extra?: React.ReactNode;
}

export function Roller({ customDice, onRoll, onManageCustom, busy, extra }: RollerProps) {
  const [pool, setPool] = useState<DiceGroup[]>([]);
  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState<Mode>("normal");
  const [label, setLabel] = useState("");
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totalDice = pool.reduce((s, g) => s + g.count, 0);
  const canAdv = pool.length === 1 && pool[0].count === 1 && pool[0].die.type === "std" && pool[0].die.sides === 20;
  const effMode: Mode = canAdv ? mode : "normal";

  const groups: DiceGroup[] = useMemo(() => {
    if (effMode === "normal") return pool;
    return [{ sign: 1, count: 2, die: pool[0].die, keep: { mode: effMode === "adv" ? "kh" : "kl", n: 1 } }];
  }, [pool, effMode]);

  const expression = groups.length ? toNotation(groups, modifier) : "";

  const add = (die: DieSpec) => {
    if (totalDice >= MAX_DICE) return;
    setError(null);
    setPool((p) => {
      const key = dieToken(die);
      const i = p.findIndex((g) => dieToken(g.die) === key);
      if (i >= 0) return p.map((g, j) => (j === i ? { ...g, count: g.count + 1 } : g));
      return [...p, { sign: 1, count: 1, die }];
    });
  };

  const dec = (i: number) => setPool((p) => p.flatMap((g, j) => (j !== i ? [g] : g.count > 1 ? [{ ...g, count: g.count - 1 }] : [])));

  const countOf = (die: DieSpec) => pool.find((g) => dieToken(g.die) === dieToken(die))?.count ?? 0;

  const resolveCustom = (name: string) => customDice.find((d) => (d.name ?? "").toLowerCase() === name.toLowerCase());

  const roll = async () => {
    setError(null);
    let req: RollRequest;
    if (typing) {
      try {
        const parsed = parseNotation(text, resolveCustom);
        req = { groups: parsed.groups, modifier: parsed.modifier, notation: toNotation(parsed.groups, parsed.modifier), label: label.trim() || undefined };
      } catch (e) {
        setError(e instanceof NotationError ? e.message : "Não entendi essa rolagem.");
        return;
      }
    } else {
      if (!groups.length) {
        setError("Escolha pelo menos um dado.");
        return;
      }
      req = { groups, modifier, notation: expression, label: label.trim() || undefined };
    }
    await onRoll(req);
  };

  return (
    <div className="panel roller">
      <div className="dice-rail" role="group" aria-label="Adicionar dados">
        {STANDARD.map((d) => (
          <DieButton key={dieToken(d)} die={d} count={countOf(d)} onAdd={() => add(d)} />
        ))}
        <DieButton die={RUNE_DIE} count={countOf(RUNE_DIE)} onAdd={() => add(RUNE_DIE)} className="rune" />
        {customDice.map((d) => (
          <DieButton key={d.id ?? dieToken(d)} die={d} count={countOf(d)} onAdd={() => add(d)} className="custom" />
        ))}
        {onManageCustom && (
          <button type="button" className="die-btn custom" onClick={onManageCustom} title="Criar ou editar dados personalizados">
            <Icon name="plus" size={26} />
            <span>Novo dado</span>
          </button>
        )}
      </div>

      {!typing ? (
        <div className="pool-row">
          {pool.length ? (
            <div className="pool-chips">
              {pool.map((g, i) => (
                <button key={dieToken(g.die)} type="button" className="chip pool-chip" onClick={() => dec(i)} title="Tirar um dado">
                  {g.count}× {dieLabel(g.die)}
                  <Icon name="x" size={14} />
                </button>
              ))}
              <span className="pool-expr" aria-live="polite">
                {expression}
              </span>
            </div>
          ) : (
            <span className="pool-expr is-empty">Toque nos dados para montar a rolagem.</span>
          )}
        </div>
      ) : (
        <div className="notation-row">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void roll();
            }}
            placeholder="2d6+3, 4d6k3, 2d20kh1+5, 1dR, 1d{Sim,Não}"
            aria-label="Rolagem em notação"
            autoFocus
          />
        </div>
      )}

      <div className="roll-row">
        {!typing && (
          <div className="stepper" aria-label="Modificador">
            <button type="button" onClick={() => setModifier((m) => Math.max(-99, m - 1))} aria-label="Diminuir modificador">
              −
            </button>
            <output>{modifier > 0 ? `+${modifier}` : modifier}</output>
            <button type="button" onClick={() => setModifier((m) => Math.min(99, m + 1))} aria-label="Aumentar modificador">
              +
            </button>
          </div>
        )}
        {!typing && canAdv && (
          <div className="seg" role="group" aria-label="Vantagem">
            {(["normal", "adv", "dis"] as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} title={m === "adv" ? "Rola 2d20 e fica com o maior" : m === "dis" ? "Rola 2d20 e fica com o menor" : undefined}>
                {m === "normal" ? "Normal" : m === "adv" ? "Vantagem" : "Desvant."}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-primary roll-btn" onClick={() => void roll()} disabled={busy}>
          {busy ? "Rolando…" : "Rolar"}
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="roller-more">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setTyping((t) => !t)}>
          {typing ? "Usar botões" : "Digitar notação"}
        </button>
        {!typing && pool.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              setPool([]);
              setModifier(0);
              setMode("normal");
            }}
          >
            Limpar
          </button>
        )}
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Para quê? Ex.: Ataque, Furtividade (opcional)"
          aria-label="Motivo da rolagem"
          maxLength={60}
        />
        {extra}
      </div>
    </div>
  );
}

function DieButton({ die, count, onAdd, className }: { die: DieSpec; count: number; onAdd: () => void; className?: string }) {
  return (
    <button type="button" className={`die-btn ${className ?? ""}`} onClick={onAdd} aria-label={`Adicionar ${dieLabel(die)}`}>
      <DieIcon die={die} />
      <span>{dieLabel(die)}</span>
      {count > 0 && <span className="count">{count}</span>}
    </button>
  );
}
