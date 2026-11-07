"use client";

import { useState } from "react";
import {
  ATTRS,
  type Attack,
  type AttrKey,
  type DndSheet,
  SKILLS,
  attackBonus,
  critNotation,
  d20Notation,
  damageNotation,
  initiativeBonus,
  mod,
  newId,
  passivePerception,
  profBonus,
  saveBonus,
  signed,
  skillBonus,
  spellAttack,
  spellDc,
} from "@/lib/sheet";

export type SheetRoll = (notation: string, label: string) => void;

type Mode = "normal" | "adv" | "dis";

function modeFrom(e: React.MouseEvent): Mode {
  if (e.shiftKey) return "adv";
  if (e.ctrlKey || e.metaKey || e.altKey) return "dis";
  return "normal";
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  width = 56,
  label,
  disabled,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  width?: number;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className={`input num ${className ?? ""}`}
      style={{ width }}
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseInt(e.target.value.replace("−", "-"), 10);
        if (Number.isFinite(n)) onChange(Math.max(min ?? -9999, Math.min(max ?? 99999, n)));
      }}
      onBlur={() => setText(null)}
      onFocus={(e) => e.target.select()}
    />
  );
}

function RollButton({ bonus, label, onRoll, title, disabled }: { bonus: number; label: string; onRoll?: SheetRoll; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="roll-bonus"
      disabled={!onRoll || disabled}
      onClick={(e) => onRoll?.(d20Notation(bonus, modeFrom(e)), label + (e.shiftKey ? " (vantagem)" : e.ctrlKey || e.metaKey || e.altKey ? " (desvantagem)" : ""))}
      title={onRoll ? `${title ?? label}: clique para rolar. Shift: vantagem. Ctrl: desvantagem.` : title}
    >
      {signed(bonus)}
    </button>
  );
}

const PROF_LABEL = ["Sem proficiência", "Proficiente", "Especialista"];

export function DndSheetView({
  sheet,
  onChange,
  onRoll,
  who,
}: {
  sheet: DndSheet;
  /** Omit to show the sheet read-only. */
  onChange?: (next: DndSheet) => void;
  onRoll?: SheetRoll;
  /** Name used in roll labels. */
  who: string;
}) {
  const ro = !onChange;
  const set = <K extends keyof DndSheet>(key: K, value: DndSheet[K]) => onChange?.({ ...sheet, [key]: value });
  const pb = profBonus(sheet.nivel);
  const [amount, setAmount] = useState(1);
  const tag = (s: string) => (who ? `${s} · ${who}` : s);

  const damage = (n: number) => {
    let temp = sheet.pvTemp;
    let pv = sheet.pv;
    const fromTemp = Math.min(temp, n);
    temp -= fromTemp;
    pv -= n - fromTemp;
    onChange?.({ ...sheet, pvTemp: temp, pv: Math.max(pv, -sheet.pvMax) });
  };
  const heal = (n: number) => onChange?.({ ...sheet, pv: Math.min(sheet.pvMax, Math.max(sheet.pv, 0) + n), morte: { sucessos: 0, falhas: 0 } });

  const setAttack = (id: string, patch: Partial<Attack>) => set("ataques", sheet.ataques.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const slots = Array.from({ length: 9 }, (_, i) => sheet.magia.slots.find((s) => s.nivel === i + 1) ?? { nivel: i + 1, total: 0, usados: 0 });
  const setSlot = (nivel: number, patch: Partial<{ total: number; usados: number }>) => {
    const next = slots.map((s) => (s.nivel === nivel ? { ...s, ...patch } : s)).map((s) => ({ ...s, usados: Math.min(s.usados, s.total) }));
    set("magia", { ...sheet.magia, slots: next.filter((s) => s.total > 0) });
  };

  const hpPct = sheet.pvMax > 0 ? Math.max(0, Math.min(1, sheet.pv / sheet.pvMax)) : 0;

  return (
    <div className="dnd-sheet">
      <div className="sheet-grid sheet-ident">
        <label className="field">
          <span>Classe</span>
          <input className="input" value={sheet.classe} disabled={ro} onChange={(e) => set("classe", e.target.value)} placeholder="Bruxo" />
        </label>
        <label className="field">
          <span>Subclasse</span>
          <input className="input" value={sheet.subclasse} disabled={ro} onChange={(e) => set("subclasse", e.target.value)} />
        </label>
        <label className="field">
          <span>Nível</span>
          <NumberInput value={sheet.nivel} min={1} max={20} label="Nível" disabled={ro} onChange={(n) => set("nivel", n)} width={64} />
        </label>
        <label className="field">
          <span>Espécie</span>
          <input className="input" value={sheet.especie} disabled={ro} onChange={(e) => set("especie", e.target.value)} placeholder="Humano" />
        </label>
        <label className="field">
          <span>Antecedente</span>
          <input className="input" value={sheet.antecedente} disabled={ro} onChange={(e) => set("antecedente", e.target.value)} />
        </label>
        <label className="field">
          <span>Alinhamento</span>
          <input className="input" value={sheet.alinhamento} disabled={ro} onChange={(e) => set("alinhamento", e.target.value)} />
        </label>
      </div>

      <div className="sheet-stats">
        <div className="stat">
          <span>CA</span>
          <NumberInput value={sheet.ca} min={0} max={99} label="Classe de armadura" disabled={ro} onChange={(n) => set("ca", n)} width={60} className="big" />
        </div>
        <div className="stat">
          <span>Iniciativa</span>
          <RollButton bonus={initiativeBonus(sheet)} label={tag("Iniciativa")} onRoll={onRoll} />
        </div>
        <div className="stat">
          <span>Deslocamento</span>
          <input className="input" style={{ width: 80 }} value={sheet.deslocamento} disabled={ro} onChange={(e) => set("deslocamento", e.target.value)} />
        </div>
        <div className="stat">
          <span>Proficiência</span>
          <b className="stat-value">{signed(pb)}</b>
        </div>
        <div className="stat">
          <span>Percepção passiva</span>
          <b className="stat-value">{passivePerception(sheet)}</b>
        </div>
        <label className="stat check">
          <span>Inspiração</span>
          <input type="checkbox" checked={sheet.inspiracao} disabled={ro} onChange={(e) => set("inspiracao", e.target.checked)} />
        </label>
      </div>

      <div className="sheet-hp">
        <div className="hp-main">
          <div className="hp-row">
            <span className="hp-label">Pontos de vida</span>
            <span className="hp-pair">
              <NumberInput value={sheet.pv} min={-9999} max={9999} label="Pontos de vida atuais" disabled={ro} onChange={(n) => set("pv", n)} width={70} className="big" />
              <span className="hint">de</span>
              <NumberInput value={sheet.pvMax} min={0} max={9999} label="Pontos de vida máximos" disabled={ro} onChange={(n) => set("pvMax", n)} width={64} />
            </span>
            <span className="hp-pair">
              <span className="hint">temp.</span>
              <NumberInput value={sheet.pvTemp} min={0} max={9999} label="Pontos de vida temporários" disabled={ro} onChange={(n) => set("pvTemp", n)} width={56} />
            </span>
          </div>
          <div className="hp-bar" aria-hidden="true">
            <span style={{ width: `${hpPct * 100}%`, background: hpPct > 0.5 ? "var(--moss)" : hpPct > 0.25 ? "var(--amber)" : "var(--madder)" }} />
          </div>
          {!ro && (
            <div className="hp-row">
              <NumberInput value={amount} min={1} max={999} label="Quantidade" onChange={setAmount} width={56} />
              <button type="button" className="btn btn-small btn-danger" onClick={() => damage(amount)}>
                Dano
              </button>
              <button type="button" className="btn btn-small" onClick={() => heal(amount)}>
                Cura
              </button>
            </div>
          )}
        </div>
        <div className="hp-side">
          <label className="field">
            <span>Dados de vida</span>
            <input className="input" style={{ width: 90 }} value={sheet.dadosVida} disabled={ro} onChange={(e) => set("dadosVida", e.target.value)} />
          </label>
          <div className="death">
            <span className="hint">Testes contra a morte</span>
            <div className="row" style={{ gap: 4 }}>
              <span className="hint">✓</span>
              {[0, 1, 2].map((i) => (
                <input
                  key={`s${i}`}
                  type="checkbox"
                  aria-label={`Sucesso ${i + 1}`}
                  disabled={ro}
                  checked={sheet.morte.sucessos > i}
                  onChange={(e) => set("morte", { ...sheet.morte, sucessos: e.target.checked ? i + 1 : i })}
                />
              ))}
              <span className="hint" style={{ marginLeft: 6 }}>
                ✗
              </span>
              {[0, 1, 2].map((i) => (
                <input
                  key={`f${i}`}
                  type="checkbox"
                  className="fail"
                  aria-label={`Falha ${i + 1}`}
                  disabled={ro}
                  checked={sheet.morte.falhas > i}
                  onChange={(e) => set("morte", { ...sheet.morte, falhas: e.target.checked ? i + 1 : i })}
                />
              ))}
              <button type="button" className="roll-bonus small" disabled={!onRoll} onClick={() => onRoll?.("1d20", tag("Teste contra a morte"))} title="Rolar teste contra a morte">
                d20
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sheet-cols">
        <section>
          <h4>Atributos</h4>
          <div className="attr-grid">
            {ATTRS.map((a) => (
              <div key={a.key} className="attr">
                <span className="attr-name" title={a.name}>
                  {a.short}
                </span>
                <RollButton bonus={mod(sheet.attrs[a.key])} label={tag(`Teste de ${a.name}`)} onRoll={onRoll} title={`Teste de ${a.name}`} />
                <NumberInput
                  value={sheet.attrs[a.key]}
                  min={1}
                  max={30}
                  label={a.name}
                  disabled={ro}
                  width={52}
                  onChange={(n) => set("attrs", { ...sheet.attrs, [a.key]: n })}
                />
              </div>
            ))}
          </div>
          <h4>Salvaguardas</h4>
          <ul className="skill-list">
            {ATTRS.map((a) => (
              <li key={a.key}>
                <input
                  type="checkbox"
                  aria-label={`Proficiente em salvaguarda de ${a.name}`}
                  disabled={ro}
                  checked={sheet.saves[a.key]}
                  onChange={(e) => set("saves", { ...sheet.saves, [a.key]: e.target.checked })}
                />
                <span className="skill-name">{a.name}</span>
                <RollButton bonus={saveBonus(sheet, a.key)} label={tag(`Salvaguarda de ${a.name}`)} onRoll={onRoll} />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Perícias</h4>
          <ul className="skill-list">
            {SKILLS.map((s) => {
              const p = sheet.skills[s.key] ?? 0;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`prof-pip p${p}`}
                    disabled={ro}
                    aria-label={`${s.name}: ${PROF_LABEL[p]}`}
                    title={`${PROF_LABEL[p]} (clique para mudar)`}
                    onClick={() => {
                      const next = ((p + 1) % 3) as 0 | 1 | 2;
                      const skills = { ...sheet.skills };
                      if (next) skills[s.key] = next;
                      else delete skills[s.key];
                      set("skills", skills);
                    }}
                  />
                  <span className="skill-name">
                    {s.name} <span className="hint">{ATTRS.find((a) => a.key === s.attr)?.short}</span>
                  </span>
                  <RollButton bonus={skillBonus(sheet, s.key)} label={tag(s.name)} onRoll={onRoll} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section>
        <div className="section-head">
          <h4>Ataques</h4>
          {!ro && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                set("ataques", [...sheet.ataques, { id: newId(), nome: "", atributo: "for", proficiente: true, bonus: 0, dano: "1d8+MOD", tipo: "" }])
              }
            >
              Adicionar ataque
            </button>
          )}
        </div>
        {sheet.ataques.length === 0 ? (
          <p className="hint">Nenhum ataque ainda. No dano, escreva MOD para somar o atributo (ex.: 1d8+MOD).</p>
        ) : (
          <div className="attacks">
            {sheet.ataques.map((a) => {
              const hit = attackBonus(sheet, a);
              const dmg = damageNotation(sheet, a);
              return (
                <div key={a.id} className="attack">
                  <input className="input" value={a.nome} disabled={ro} placeholder="Nome" aria-label="Nome do ataque" onChange={(e) => setAttack(a.id, { nome: e.target.value })} />
                  <select
                    className="select"
                    value={a.atributo}
                    disabled={ro}
                    aria-label="Atributo do ataque"
                    onChange={(e) => setAttack(a.id, { atributo: e.target.value as AttrKey | "nenhum" })}
                  >
                    {ATTRS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.short}
                      </option>
                    ))}
                    <option value="nenhum">—</option>
                  </select>
                  <label className="check" title="Proficiente com esta arma">
                    <input type="checkbox" checked={a.proficiente} disabled={ro} onChange={(e) => setAttack(a.id, { proficiente: e.target.checked })} />
                    Prof.
                  </label>
                  <RollButton bonus={hit} label={tag(`Ataque: ${a.nome || "arma"}`)} onRoll={onRoll} title={`Acerto com ${a.nome || "a arma"}`} />
                  <input className="input" value={a.dano} disabled={ro} aria-label="Dano" placeholder="1d8+MOD" onChange={(e) => setAttack(a.id, { dano: e.target.value })} />
                  <button
                    type="button"
                    className="roll-bonus dmg"
                    disabled={!onRoll || !dmg}
                    title={`Rolar dano: ${dmg}`}
                    onClick={(e) => {
                      // Shift: critical hit, dice doubled
                      const notation = e.shiftKey ? critNotation(dmg) : dmg;
                      onRoll?.(notation, tag(`Dano: ${a.nome || "arma"}${e.shiftKey ? " (crítico)" : ""}`));
                    }}
                  >
                    {dmg || "dano"}
                  </button>
                  <input className="input" value={a.tipo} disabled={ro} aria-label="Tipo de dano" placeholder="cortante" onChange={(e) => setAttack(a.id, { tipo: e.target.value })} />
                  {!ro && (
                    <button type="button" className="icon-btn" aria-label={`Remover ${a.nome || "ataque"}`} onClick={() => set("ataques", sheet.ataques.filter((x) => x.id !== a.id))}>
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <p className="hint">Shift no dano rola crítico (dados dobrados).</p>
          </div>
        )}
      </section>

      <section>
        <h4>Magia</h4>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ minWidth: 140 }}>
            <span>Atributo de conjuração</span>
            <select
              className="select"
              value={sheet.magia.atributo}
              disabled={ro}
              onChange={(e) => set("magia", { ...sheet.magia, atributo: e.target.value as AttrKey | "" })}
            >
              <option value="">Nenhum</option>
              {ATTRS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {sheet.magia.atributo && (
            <>
              <div className="stat">
                <span>CD</span>
                <b className="stat-value">{spellDc(sheet)}</b>
              </div>
              <div className="stat">
                <span>Ataque mágico</span>
                <RollButton bonus={spellAttack(sheet) ?? 0} label={tag("Ataque mágico")} onRoll={onRoll} />
              </div>
            </>
          )}
        </div>
        <div className="slots">
          {slots.map((s) => (
            <div key={s.nivel} className={`slot${s.total ? "" : " empty"}`}>
              <span className="hint">{s.nivel}º</span>
              <NumberInput value={s.total} min={0} max={9} label={`Espaços de ${s.nivel}º círculo`} disabled={ro} width={40} onChange={(n) => setSlot(s.nivel, { total: n })} />
              <span className="pips">
                {Array.from({ length: s.total }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={ro}
                    className={`pip${i < s.usados ? " used" : ""}`}
                    aria-label={`Espaço ${i + 1} de ${s.nivel}º círculo ${i < s.usados ? "gasto" : "livre"}`}
                    onClick={() => setSlot(s.nivel, { usados: i < s.usados ? i : i + 1 })}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
        <label className="field">
          <span>Magias conhecidas e preparadas</span>
          <textarea className="textarea" value={sheet.magia.lista} disabled={ro} onChange={(e) => set("magia", { ...sheet.magia, lista: e.target.value })} rows={4} />
        </label>
      </section>

      <section>
        <h4>Moedas</h4>
        <div className="row" style={{ gap: 10 }}>
          {(["pc", "pp", "pe", "po", "pl"] as const).map((k) => (
            <label key={k} className="field coin">
              <span>{k.toUpperCase()}</span>
              <NumberInput
                value={sheet.moedas[k]}
                min={0}
                max={9999999}
                label={{ pc: "Peças de cobre", pp: "Peças de prata", pe: "Peças de electrum", po: "Peças de ouro", pl: "Peças de platina" }[k]}
                disabled={ro}
                width={76}
                onChange={(n) => set("moedas", { ...sheet.moedas, [k]: n })}
              />
            </label>
          ))}
        </div>
      </section>

      <div className="sheet-texts">
        {(
          [
            ["caracteristicas", "Características e talentos"],
            ["proficiencias", "Proficiências e idiomas"],
            ["inventario", "Equipamento"],
            ["notas", "Notas"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <textarea className="textarea" rows={5} value={sheet[k]} disabled={ro} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}
