/**
 * Runs the migration against a real PostgreSQL with a stubbed `auth` schema and
 * checks the rules the app relies on (row level security, server-side rolls).
 * Needs RUNA_TEST_DB, e.g. postgres://postgres@127.0.0.1:54322/runa_test_x
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.RUNA_TEST_DB;
const root = path.resolve(__dirname, "..");

const A = "00000000-0000-4000-8000-00000000000a"; // mestre
const B = "00000000-0000-4000-8000-00000000000b"; // jogador
const C = "00000000-0000-4000-8000-00000000000c"; // de fora
const D = "00000000-0000-4000-8000-00000000000d"; // outro jogador
const G = "00000000-0000-4000-8000-00000000000e"; // convidado

describe.skipIf(!url)("database rules", () => {
  let db: pg.Client;
  let mesaId = "";
  let code = "";

  const as = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows as T[];
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const dbName = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    await admin.end();
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query(readFileSync(path.join(root, "tests/sql/supabase-stub.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.query(readFileSync(path.join(dir, f), "utf8"));
    for (const [id, meta] of [
      [A, { username: "astrid", display_name: "Astrid" }],
      [B, { username: "bjorn", display_name: "Bjorn" }],
      [C, { username: "cnut", display_name: "Cnut" }],
      [D, { username: "dagny", display_name: "Dagny" }],
      [G, { username: "convidado_x1", display_name: "Visitante", is_guest: true }],
    ] as const)
      await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, meta]);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("creates profiles from auth metadata", async () => {
    const [p] = await as(A, "select * from ensure_profile()");
    expect(p).toMatchObject({ id: A, username: "astrid", display_name: "Astrid", is_guest: false });
    const [g] = await as(G, "select * from ensure_profile()");
    expect(g.is_guest).toBe(true);
    for (const u of [B, C, D]) await as(u, "select ensure_profile()");
  });

  it("lets a user open a table and become its game master", async () => {
    const [m] = await as<{ id: string; code: string; owner_id: string; rune_system: boolean }>(
      A,
      "select * from create_mesa($1, $2, $3, $4, $5)",
      ["Jornada ao Ragnarök", "campanha", "D&D 5.5", "Os nove mundos", true],
    );
    expect(m.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(m.owner_id).toBe(A);
    expect(m.rune_system).toBe(true);
    mesaId = m.id;
    code = m.code;
    const [st] = await as<{ s: { role: string; members: unknown[] } }>(A, "select mesa_state($1) as s", [mesaId]);
    expect(st.s.role).toBe("mestre");
    expect(st.s.members).toHaveLength(1);
  });

  it("guests cannot open tables", async () => {
    await expect(as(G, "select * from create_mesa('x')")).rejects.toThrow(/conta/);
  });

  it("joins by code, case and spaces ignored", async () => {
    const [r] = await as<{ j: { role: string; mesa: { id: string } } }>(B, "select join_mesa($1) as j", [`  ${code.toLowerCase()} `]);
    expect(r.j.role).toBe("jogador");
    expect(r.j.mesa.id).toBe(mesaId);
    const [again] = await as<{ j: { role: string } }>(A, "select join_mesa($1) as j", [code]);
    expect(again.j.role).toBe("mestre");
    await as(D, "select join_mesa($1)", [code]);
    await as(G, "select join_mesa($1)", [code]);
    await expect(as(C, "select join_mesa('ZZZZZZ')")).rejects.toThrow(/Não existe mesa/);
  });

  it("keeps outsiders out", async () => {
    expect(await as(C, "select * from mesas")).toHaveLength(0);
    expect(await as(C, "select * from mesa_members")).toHaveLength(0);
    await expect(as(C, "select mesa_state($1)", [mesaId])).rejects.toThrow(/não está nesta mesa/);
    const profs = await as<{ id: string }>(C, "select id from profiles");
    expect(profs.map((p) => p.id)).toEqual([C]);
    const seen = await as<{ id: string }>(B, "select id from profiles order by username");
    expect(seen.map((p) => p.id).sort()).toEqual([A, B, D, G].sort());
  });

  it("rolls on the server with valid values", async () => {
    const groups = [{ sign: 1, count: 2, die: { type: "std", sides: 20 }, keep: { mode: "kh", n: 1 } }];
    const [r] = await as<{ groups: { values: number[] }[]; roller_name: string; seed: number; modifier: number }>(
      B,
      "select * from roll_dice($1, $2, $3, $4, $5, $6)",
      [mesaId, JSON.stringify(groups), 3, "2d20kh1+3", "Ataque", false],
    );
    expect(r.groups[0].values).toHaveLength(2);
    for (const v of r.groups[0].values) expect(v >= 1 && v <= 20).toBe(true);
    expect(r.roller_name).toBe("Bjorn");
    expect(r.modifier).toBe(3);
    expect(Number.isInteger(r.seed)).toBe(true);

    const rune = [{ sign: 1, count: 1, die: { type: "rune", sides: 24 } }];
    const [rr] = await as<{ groups: { values: number[] }[] }>(B, "select * from roll_dice($1, $2)", [mesaId, JSON.stringify(rune)]);
    expect(rr.groups[0].values[0]).toBeGreaterThanOrEqual(1);
    expect(rr.groups[0].values[0]).toBeLessThanOrEqual(24);

    const faces = [{ sign: 1, count: 3, die: { type: "faces", sides: 3, faces: ["Sim", "Não", "Talvez"], name: "Oráculo" } }];
    const [fr] = await as<{ groups: { values: number[]; die: { name: string } }[] }>(B, "select * from roll_dice($1, $2)", [mesaId, JSON.stringify(faces)]);
    expect(fr.groups[0].die.name).toBe("Oráculo");
    expect(fr.groups[0].values).toHaveLength(3);
  });

  it("rejects malformed rolls and outsiders", async () => {
    const bad = [
      [{ sign: 1, count: 0, die: { type: "std", sides: 20 } }],
      [{ sign: 1, count: 1, die: { type: "std", sides: 1 } }],
      [{ sign: 1, count: 61, die: { type: "std", sides: 6 } }],
      [{ sign: 1, count: 1, die: { type: "pct", sides: 99 } }],
      [{ sign: 1, count: 1, die: { type: "faces", sides: 3, faces: ["a", "b"] } }],
      [{ sign: 1, count: 2, die: { type: "std", sides: 6 }, keep: { mode: "kh", n: 3 } }],
      [{ sign: 1, count: 1, die: { type: "xyz", sides: 6 } }],
      [],
    ];
    for (const g of bad) await expect(as(B, "select * from roll_dice($1, $2)", [mesaId, JSON.stringify(g)])).rejects.toThrow();
    await expect(as(C, "select * from roll_dice($1, $2)", [mesaId, JSON.stringify([{ sign: 1, count: 1, die: { type: "std", sides: 6 } }])])).rejects.toThrow(
      /não está nesta mesa/,
    );
  });

  it("shows secret rolls only to the roller and the game master", async () => {
    const g = JSON.stringify([{ sign: 1, count: 1, die: { type: "std", sides: 20 } }]);
    const [secret] = await as<{ id: string }>(D, "select * from roll_dice($1, $2, 0, '1d20', 'Intuição', true)", [mesaId, g]);
    const ids = async (u: string) => (await as<{ id: string }>(u, "select id from rolls")).map((r) => r.id);
    expect(await ids(D)).toContain(secret.id);
    expect(await ids(A)).toContain(secret.id);
    expect(await ids(B)).not.toContain(secret.id);
    expect((await ids(B)).length).toBeGreaterThan(0);
    expect(await ids(C)).toHaveLength(0);
  });

  it("forbids direct writes outside the allowed columns", async () => {
    await expect(as(B, "insert into rolls (mesa_id, user_id, roller_name, roller_color, notation, groups, seed) values ($1, $2, 'x', '#000000', '1d20', '[]', 1)", [mesaId, B])).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(B, "update mesa_members set role = 'mestre' where user_id = $1", [B])).rejects.toThrow(/permission denied/);
    const upd = await as(B, "update mesas set name = 'hack' where id = $1 returning id", [mesaId]);
    expect(upd).toHaveLength(0);
    const mine = await as<{ character_name: string }>(B, "update mesa_members set character_name = 'Thorkell', rune = 'raidho' where mesa_id = $1 and user_id = $2 returning character_name", [
      mesaId,
      B,
    ]);
    expect(mine[0].character_name).toBe("Thorkell");
    const other = await as(B, "update mesa_members set character_name = 'x' where user_id = $1 returning 1", [D]);
    expect(other).toHaveLength(0);
    const renamed = await as(A, "update mesas set name = 'Jornada' where id = $1 returning name", [mesaId]);
    expect(renamed).toHaveLength(1);
  });

  it("uses the character name and rune on later rolls", async () => {
    const g = JSON.stringify([{ sign: 1, count: 1, die: { type: "rune", sides: 24 } }]);
    const [r] = await as<{ roller_name: string; roller_rune: string }>(B, "select * from roll_dice($1, $2)", [mesaId, g]);
    expect(r.roller_name).toBe("Thorkell");
    expect(r.roller_rune).toBe("raidho");
  });

  it("shares table dice only from the game master", async () => {
    const spec = JSON.stringify({ type: "faces", sides: 2, faces: ["Sim", "Não"] });
    await as(A, "insert into custom_dice (mesa_id, name, spec) values ($1, 'Oráculo', $2)", [mesaId, spec]);
    await expect(as(B, "insert into custom_dice (mesa_id, name, spec) values ($1, 'Meu', $2)", [mesaId, spec])).rejects.toThrow(/row-level security/);
    await as(B, "insert into custom_dice (name, spec) values ('Pessoal', $1)", [spec]);
    const bSees = await as<{ name: string }>(B, "select name from custom_dice order by name");
    expect(bSees.map((d) => d.name)).toEqual(["Oráculo", "Pessoal"]);
    const dSees = await as<{ name: string }>(D, "select name from custom_dice order by name");
    expect(dSees.map((d) => d.name)).toEqual(["Oráculo"]);
    const del = await as(B, "delete from custom_dice where name = 'Oráculo' returning 1");
    expect(del).toHaveLength(0);
  });

  it("lets players leave and the master remove, but not leave", async () => {
    const left = await as(G, "delete from mesa_members where mesa_id = $1 and user_id = $2 returning 1", [mesaId, G]);
    expect(left).toHaveLength(1);
    const self = await as(A, "delete from mesa_members where mesa_id = $1 and user_id = $2 returning 1", [mesaId, A]);
    expect(self).toHaveLength(0);
    const kicked = await as(A, "delete from mesa_members where mesa_id = $1 and user_id = $2 returning 1", [mesaId, D]);
    expect(kicked).toHaveLength(1);
    const notByPlayer = await as(B, "delete from mesa_members where mesa_id = $1 and user_id = $2 returning 1", [mesaId, A]);
    expect(notByPlayer).toHaveLength(0);
  });

  it("only the master changes the code", async () => {
    await expect(as(B, "select regenerate_code($1)", [mesaId])).rejects.toThrow(/mestre/);
    const [r] = await as<{ c: string }>(A, "select regenerate_code($1) as c", [mesaId]);
    expect(r.c).not.toBe(code);
  });

  it("lists my tables with my role", async () => {
    const [a] = await as<{ m: { role: string; members: number; owner_name: string }[] }>(A, "select my_mesas() as m");
    expect(a.m[0]).toMatchObject({ role: "mestre", owner_name: "Astrid" });
    const [b] = await as<{ m: { role: string; character_name: string }[] }>(B, "select my_mesas() as m");
    expect(b.m[0]).toMatchObject({ role: "jogador", character_name: "Thorkell" });
    const [c] = await as<{ m: unknown[] }>(C, "select my_mesas() as m");
    expect(c.m).toEqual([]);
  });

  it("rolls uniformly", async () => {
    const r = await db.query("select public.rand_int(6) v from generate_series(1, 12000)");
    const counts = [0, 0, 0, 0, 0, 0];
    for (const row of r.rows) counts[row.v - 1]++;
    for (const c of counts) expect(c).toBeGreaterThan(1800);
    for (const c of counts) expect(c).toBeLessThan(2200);
  });

  it("cannot call private helpers", async () => {
    await expect(as(B, "select rand_int(6)")).rejects.toThrow(/permission denied/);
  });

  it("deleting the table removes everything in it", async () => {
    await as(A, "delete from mesas where id = $1", [mesaId]);
    const [{ n }] = (await db.query("select count(*)::int n from rolls where mesa_id = $1", [mesaId])).rows;
    expect(n).toBe(0);
  });
});
