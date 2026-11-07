"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DieSpec, RollRecord, RollRequest, RolledGroup } from "./dice/types";
import { supabase } from "./supabase/client";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  dice_color: string;
  is_guest: boolean;
}

export interface Mesa {
  id: string;
  code: string;
  owner_id: string;
  name: string;
  kind: "campanha" | "avulsa";
  system: string;
  description: string;
  rune_system: boolean;
  created_at: string;
  last_roll_at: string | null;
}

export interface MesaSummary extends Mesa {
  owner_name: string;
  role: "mestre" | "jogador";
  character_name: string;
  character_notes: string;
  rune: string | null;
  color: string | null;
  members: number;
}

export interface Member {
  user_id: string;
  role: "mestre" | "jogador";
  character_name: string;
  character_notes: string;
  rune: string | null;
  color: string;
  display_name: string;
  username: string;
  is_guest: boolean;
  joined_at: string;
}

export interface MesaState {
  mesa: Mesa;
  role: "mestre" | "jogador";
  members: Member[];
}

export interface SavedDie {
  id: string;
  owner_id: string;
  mesa_id: string | null;
  name: string;
  spec: DieSpec;
}

interface RollRow {
  id: string;
  mesa_id: string;
  user_id: string | null;
  roller_name: string;
  roller_color: string;
  roller_rune: string | null;
  label: string | null;
  notation: string;
  groups: RolledGroup[];
  modifier: number;
  seed: number;
  is_private: boolean;
  created_at: string;
}

/** Turns Postgres / Supabase errors into a sentence for the interface. */
export function errorMessage(e: unknown): string {
  if (!e) return "Algo deu errado.";
  const err = e as { message?: string; code?: string; details?: string };
  const msg = err.message ?? String(e);
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  if (/JWT|not authenticated|Faça login/i.test(msg)) return "Sua sessão expirou. Entre de novo.";
  if (err.code === "42501" && !/[áéíóúãõç]/i.test(msg)) return "Você não tem permissão para isso.";
  return msg;
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data;
}

export function toRecord(row: RollRow): RollRecord {
  return {
    id: row.id,
    notation: row.notation,
    label: row.label,
    groups: row.groups,
    modifier: row.modifier,
    createdAt: row.created_at,
    by: { id: row.user_id ?? "", name: row.roller_name, color: row.roller_color, rune: row.roller_rune },
    isPrivate: row.is_private,
    seed: row.seed,
  };
}

// ------------------------------------------------------------------ profile

export async function ensureProfile(): Promise<Profile> {
  return check(await supabase().rpc("ensure_profile")) as Profile;
}

export async function updateProfile(id: string, patch: Partial<Pick<Profile, "display_name" | "dice_color">>) {
  check(await supabase().from("profiles").update(patch).eq("id", id));
}

// ------------------------------------------------------------------ mesas

export async function myMesas(): Promise<MesaSummary[]> {
  return (check(await supabase().rpc("my_mesas")) as MesaSummary[]) ?? [];
}

export async function createMesa(input: { name: string; kind: "campanha" | "avulsa"; system?: string; description?: string; runeSystem?: boolean }): Promise<Mesa> {
  return check(
    await supabase().rpc("create_mesa", {
      p_name: input.name,
      p_kind: input.kind,
      p_system: input.system ?? "D&D 5.5",
      p_description: input.description ?? "",
      p_rune_system: input.runeSystem ?? false,
    }),
  ) as Mesa;
}

export async function joinMesa(code: string): Promise<{ mesa: Mesa; role: "mestre" | "jogador" }> {
  return check(await supabase().rpc("join_mesa", { p_code: code })) as { mesa: Mesa; role: "mestre" | "jogador" };
}

export async function mesaState(mesaId: string): Promise<MesaState> {
  return check(await supabase().rpc("mesa_state", { p_mesa: mesaId })) as MesaState;
}

export async function updateMesa(id: string, patch: Partial<Pick<Mesa, "name" | "system" | "description" | "rune_system">>) {
  check(await supabase().from("mesas").update(patch).eq("id", id));
}

export async function deleteMesa(id: string) {
  check(await supabase().from("mesas").delete().eq("id", id));
}

export async function regenerateCode(id: string): Promise<string> {
  return check(await supabase().rpc("regenerate_code", { p_mesa: id })) as string;
}

export async function updateMyMember(
  mesaId: string,
  userId: string,
  patch: Partial<Pick<Member, "character_name" | "character_notes" | "rune" | "color">>,
) {
  check(await supabase().from("mesa_members").update(patch).eq("mesa_id", mesaId).eq("user_id", userId));
}

export async function removeMember(mesaId: string, userId: string) {
  check(await supabase().from("mesa_members").delete().eq("mesa_id", mesaId).eq("user_id", userId));
}

// ------------------------------------------------------------------ rolls

export async function recentRolls(mesaId: string, limit = 60): Promise<RollRecord[]> {
  const rows = check(
    await supabase().from("rolls").select("*").eq("mesa_id", mesaId).order("created_at", { ascending: false }).limit(limit),
  ) as RollRow[];
  return rows.map(toRecord);
}

export async function rollAtMesa(mesaId: string, req: RollRequest, isPrivate: boolean): Promise<RollRecord> {
  const groups = req.groups.map((g) => ({
    sign: g.sign,
    count: g.count,
    die: { type: g.die.type, sides: g.die.sides, ...(g.die.faces ? { faces: g.die.faces } : {}), ...(g.die.name ? { name: g.die.name } : {}) },
    ...(g.keep ? { keep: g.keep } : {}),
  }));
  const row = check(
    await supabase().rpc("roll_dice", {
      p_mesa: mesaId,
      p_groups: groups,
      p_modifier: req.modifier,
      p_notation: req.notation,
      p_label: req.label ?? null,
      p_private: isPrivate,
    }),
  ) as RollRow;
  return toRecord(row);
}

export async function clearRolls(mesaId: string) {
  check(await supabase().from("rolls").delete().eq("mesa_id", mesaId));
}

// ------------------------------------------------------------------ custom dice

function toSaved(row: { id: string; owner_id: string; mesa_id: string | null; name: string; spec: DieSpec }): SavedDie {
  return { ...row, spec: { ...row.spec, id: row.id, name: row.name } };
}

export async function listCustomDice(): Promise<SavedDie[]> {
  const rows = check(await supabase().from("custom_dice").select("id, owner_id, mesa_id, name, spec").order("created_at")) as SavedDie[];
  return rows.map(toSaved);
}

export async function createCustomDie(name: string, spec: DieSpec, mesaId: string | null): Promise<SavedDie> {
  const clean: DieSpec = { type: spec.type, sides: spec.sides, ...(spec.faces ? { faces: spec.faces } : {}) };
  const row = check(
    await supabase().from("custom_dice").insert({ name, spec: clean, mesa_id: mesaId }).select("id, owner_id, mesa_id, name, spec").single(),
  ) as SavedDie;
  return toSaved(row);
}

export async function deleteCustomDie(id: string) {
  check(await supabase().from("custom_dice").delete().eq("id", id));
}

// ------------------------------------------------------------------ realtime

export interface PresenceUser {
  user_id: string;
  name: string;
  color: string;
}

export interface MesaHandlers {
  onRoll(record: RollRecord): void;
  onMembersChanged(): void;
  onDiceChanged(): void;
  onPresence(users: PresenceUser[]): void;
  onStatus?(status: "online" | "offline"): void;
}

/** Live updates of a table: new rolls, member changes and who is online. */
export function subscribeMesa(mesaId: string, me: PresenceUser, h: MesaHandlers): { unsubscribe(): void; updatePresence(p: PresenceUser): void } {
  const sb = supabase();
  let channel: RealtimeChannel | null = null;
  let current = me;
  channel = sb
    .channel(`mesa:${mesaId}`, { config: { presence: { key: me.user_id } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "rolls", filter: `mesa_id=eq.${mesaId}` }, (payload) => {
      h.onRoll(toRecord(payload.new as RollRow));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "mesa_members", filter: `mesa_id=eq.${mesaId}` }, () => h.onMembersChanged())
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_dice", filter: `mesa_id=eq.${mesaId}` }, () => h.onDiceChanged())
    .on("presence", { event: "sync" }, () => {
      const state = channel!.presenceState<PresenceUser>();
      const users = Object.values(state)
        .map((list) => list[list.length - 1])
        .filter(Boolean);
      h.onPresence(users);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        h.onStatus?.("online");
        void channel!.track(current);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        h.onStatus?.("offline");
      }
    });
  return {
    unsubscribe() {
      if (channel) void sb.removeChannel(channel);
      channel = null;
    },
    updatePresence(p) {
      current = p;
      void channel?.track(p);
    },
  };
}
