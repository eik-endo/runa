"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { type TrayHandle, DiceTrayView } from "@/components/DiceTrayView";
import { RequireAccount } from "@/components/OnlineGate";
import { Roller } from "@/components/Roller";
import { SheetEditor } from "@/components/sheet/SheetEditor";
import { toast } from "@/components/Toaster";
import { type Ficha, errorMessage, getFicha } from "@/lib/api";
import { DEFAULT_DICE_COLOR } from "@/lib/colors";
import { NotationError, parseNotation, toNotation } from "@/lib/dice/notation";
import { rollLocally } from "@/lib/dice/roll";
import type { RollRequest } from "@/lib/dice/types";

function Editor({ id }: { id: string }) {
  const { profile } = useAuth();
  const tray = useRef<TrayHandle>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFicha(id)
      .then((f) => (f ? setFicha(f) : setError("Ficha não encontrada.")))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  const roll = useCallback(
    async (req: RollRequest) => {
      tray.current?.unlockAudio();
      const record = rollLocally(req, { id: "local", name: ficha?.name ?? "Você", color: profile?.dice_color ?? DEFAULT_DICE_COLOR });
      await tray.current?.play(record);
    },
    [ficha?.name, profile?.dice_color],
  );

  const rollNotation = useCallback(
    (notation: string, label: string) => {
      try {
        const p = parseNotation(notation);
        void roll({ groups: p.groups, modifier: p.modifier, notation: toNotation(p.groups, p.modifier), label });
      } catch (e) {
        toast(e instanceof NotationError ? e.message : "Não deu para rolar isso.");
      }
    },
    [roll],
  );

  if (error)
    return (
      <div className="page page-narrow">
        <div className="empty">
          <span>{error}</span>
          <Link className="btn" href="/jogador#fichas">
            Voltar para as fichas
          </Link>
        </div>
      </div>
    );
  if (!ficha) return <p className="loading">Abrindo ficha…</p>;
  const mine = ficha.owner_id === profile?.id;

  return (
    <div className="split-page">
      <div className="table-main">
        <DiceTrayView ref={tray} emptyHint="Clique nos bônus da ficha para rolar aqui." />
        <Roller customDice={[]} onRoll={roll} />
      </div>
      <aside className="panel side-sheet">
        <div className="side-sheet-top">
          <Link href="/jogador#fichas" className="hint">
            ← Suas fichas
          </Link>
          <span className="hint">As rolagens desta página ficam só neste aparelho.</span>
        </div>
        <SheetEditor ficha={ficha} readOnly={!mine} onRoll={rollNotation} />
      </aside>
    </div>
  );
}

export default function FichaPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccount next={`/fichas/${params.id}`}>
      <Editor id={params.id} />
    </RequireAccount>
  );
}
