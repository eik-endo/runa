"use client";

import { useCallback, useRef, useState } from "react";
import { DEFAULT_DICE_COLOR } from "@/lib/colors";
import { newId, rollLocally } from "@/lib/dice/roll";
import type { DieSpec, RollRecord, RollRequest } from "@/lib/dice/types";
import { useLocalState } from "@/lib/use-local";
import { CustomDiceDialog } from "./CustomDiceDialog";
import { type TrayHandle, DiceTrayView } from "./DiceTrayView";
import { Dialog } from "./Dialog";
import { Icon } from "./glyphs";
import { ColorPicker, RunePicker } from "./pickers";
import { RollLog } from "./RollLog";
import { Roller } from "./Roller";

const MAX_LOG = 80;

/** The home page: a private table on this device, no account needed. */
export function SoloTable() {
  const tray = useRef<TrayHandle>(null);
  const [log, setLog] = useLocalState<RollRecord[]>("runa:log", []);
  const [custom, setCustom] = useLocalState<DieSpec[]>("runa:custom", []);
  const [name, setName] = useLocalState("runa:name", "Você");
  const [color, setColor] = useLocalState("runa:color", DEFAULT_DICE_COLOR);
  const [rune, setRune] = useLocalState<string | null>("runa:rune", null);
  const [showCustom, setShowCustom] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const roll = useCallback(
    async (req: RollRequest) => {
      tray.current?.unlockAudio();
      const record = rollLocally(req, { id: "local", name: name || "Você", color, rune });
      await tray.current?.play(record);
      setLog((l) => [record, ...l].slice(0, MAX_LOG));
    },
    [name, color, rune, setLog],
  );

  const repeat = useCallback(
    (r: RollRecord) => {
      void roll({ groups: r.groups.map(({ values: _v, ...g }) => g), modifier: r.modifier, notation: r.notation, label: r.label ?? undefined });
    },
    [roll],
  );

  return (
    <div className="table-layout">
      <div className="table-main">
        <DiceTrayView ref={tray} emptyHint="Escolha os dados abaixo e toque em Rolar." runeOf={() => rune} />
        <Roller customDice={custom} onRoll={roll} onManageCustom={() => setShowCustom(true)} />
      </div>
      <aside className="table-side">
        <div className="panel mesa-bar">
          <span className="dot" style={{ background: color, width: 14, height: 14 }} />
          <div style={{ display: "grid", minWidth: 0, flex: 1 }}>
            <span className="mesa-name">Mesa solo</span>
            <span className="hint">As rolagens ficam só neste aparelho.</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setShowPrefs(true)} aria-label="Preferências" title="Nome, cor e runa">
            <Icon name="gear" />
          </button>
        </div>
        <RollLog
          records={log}
          runeOf={() => rune}
          onRepeat={repeat}
          actions={
            log.length > 0 && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setLog([])}>
                Apagar histórico
              </button>
            )
          }
          emptyText="Suas rolagens aparecem aqui. Para jogar com o grupo, crie uma mesa na área do Mestre."
        />
      </aside>

      {showCustom && (
        <CustomDiceDialog
          dice={custom}
          onClose={() => setShowCustom(false)}
          onCreate={({ name: n, die }) => setCustom((c) => [...c, { ...die, name: n, id: newId() }])}
          onDelete={(d) => setCustom((c) => c.filter((x) => x.id !== d.id))}
        />
      )}
      {showPrefs && (
        <Dialog title="Preferências" onClose={() => setShowPrefs(false)}>
          <label className="field">
            <span>Seu nome no histórico</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} />
          </label>
          <ColorPicker value={color} onChange={setColor} />
          <RunePicker value={rune} onChange={setRune} />
          <div className="row">
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={() => setShowPrefs(false)}>
              Pronto
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
