"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Ficha, type Member, type Profile, createFicha, errorMessage, getFicha, myFichas, updateMyMember } from "@/lib/api";
import { emptyDnd } from "@/lib/sheet";
import type { SheetRoll } from "./sheet/DndSheetView";
import { SheetEditor } from "./sheet/SheetEditor";
import { useLocalState } from "@/lib/use-local";
import { toast } from "./Toaster";

/**
 * The "Ficha" tab of a table. Players pick which of their sheets they use here
 * and play from it; the game master can read the sheets players linked.
 */
export function MesaSheetTab({
  mesaId,
  me,
  master,
  members,
  onRoll,
  onLinked,
}: {
  mesaId: string;
  me: Profile;
  master: boolean;
  members: Member[];
  onRoll: SheetRoll;
  onLinked: () => void;
}) {
  const myMember = members.find((m) => m.user_id === me.id);
  const [mine, setMine] = useState<Ficha[] | null>(null);
  // players see the sheet they linked; the game master's pick is remembered per table
  const [playerView, setPlayerView] = useState<string | null>(myMember?.ficha_id ?? null);
  const [masterView, setMasterView] = useLocalState<string | null>(`runa:mesa-ficha:${mesaId}`, null);
  const viewing = master ? masterView : playerView;
  const setViewing = master ? setMasterView : setPlayerView;
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      setMine(await myFichas(me.id));
    } catch (e) {
      toast(errorMessage(e));
      setMine([]);
    }
  }, [me.id]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // follow the linked sheet when it changes (also on other devices)
  useEffect(() => {
    if (!master) setPlayerView(myMember?.ficha_id ?? null);
  }, [master, myMember?.ficha_id]);

  useEffect(() => {
    let alive = true;
    setFicha(null);
    if (!viewing) return;
    getFicha(viewing)
      .then((f) => {
        if (!alive) return;
        if (f) setFicha(f);
        else setViewing(null); // deleted, or the player took it off this table
      })
      .catch((e) => alive && toast(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing]);

  const link = async (id: string | null) => {
    setBusy(true);
    try {
      await updateMyMember(mesaId, me.id, { ficha_id: id });
      setViewing(id);
      onLinked();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async () => {
    setBusy(true);
    try {
      const f = await createFicha(myMember?.character_name || me.display_name, "dnd5e", emptyDnd());
      setMine((list) => [f, ...(list ?? [])]);
      if (master) setViewing(f.id);
      else await link(f.id);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const linkedPlayers = members.filter((m) => m.user_id !== me.id && m.ficha_id);
  const isMine = ficha ? ficha.owner_id === me.id : false;

  return (
    <div className="mesa-sheet">
      <div className="mesa-sheet-bar">
        {master ? (
          <select className="select" value={viewing ?? ""} onChange={(e) => setViewing(e.target.value || null)} aria-label="Ficha mostrada">
            <option value="">Escolha uma ficha…</option>
            {linkedPlayers.length > 0 && (
              <optgroup label="Fichas dos jogadores">
                {linkedPlayers.map((m) => (
                  <option key={m.user_id} value={m.ficha_id!}>
                    {m.character_name || m.display_name}
                  </option>
                ))}
              </optgroup>
            )}
            {(mine ?? []).length > 0 && (
              <optgroup label="Suas fichas (NPCs)">
                {(mine ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          (mine ?? []).length > 0 && (
            <select
              className="select"
              value={myMember?.ficha_id ?? ""}
              disabled={busy}
              onChange={(e) => void link(e.target.value || null)}
              aria-label="Ficha usada nesta mesa"
            >
              <option value="">Nenhuma ficha nesta mesa</option>
              {(mine ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )
        )}
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void createAndLink()}>
          {master ? "Nova ficha de NPC" : "Nova ficha"}
        </button>
        <Link className="btn btn-ghost btn-small" href="/jogador#fichas" target="_blank">
          Todas as fichas
        </Link>
      </div>

      {mine === null ? (
        <p className="loading">Carregando fichas…</p>
      ) : !viewing ? (
        <div className="empty">
          {master
            ? linkedPlayers.length
              ? "Escolha acima a ficha de um jogador para acompanhar. Ela atualiza sozinha quando o jogador mexe."
              : "Quando os jogadores escolherem a ficha deles nesta mesa, você consegue ler aqui. Você também pode criar fichas de NPCs."
            : (mine ?? []).length
              ? "Escolha acima qual ficha você usa nesta mesa."
              : "Você ainda não tem ficha. Crie uma: ela fica salva na sua conta e os bônus rolam com um clique."}
        </div>
      ) : !ficha ? (
        <p className="loading">Abrindo ficha…</p>
      ) : (
        <SheetEditor ficha={ficha} readOnly={!isMine} onRoll={isMine ? onRoll : undefined} compact />
      )}
    </div>
  );
}
