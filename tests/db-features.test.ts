/**
 * Rules for the second batch of features: table browser, sheets, music,
 * initiative and notes. Needs RUNA_TEST_DB (see db.test.ts).
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, freshDb } from "./db-helpers";

const base = process.env.RUNA_TEST_DB;
const url = base ? base.replace(/\/[^/]+$/, "/runa_vitest_features") : undefined;

const M = "00000000-0000-4000-8000-0000000000a1"; // mestre
const P = "00000000-0000-4000-8000-0000000000b1"; // jogador na mesa
const O = "00000000-0000-4000-8000-0000000000c1"; // outra pessoa
const G = "00000000-0000-4000-8000-0000000000d1"; // convidado

const track = (n: number) => ({ titulo: `Faixa ${n}`, url: `https://exemplo.com/${n}.mp3`, tipo: "audio" });

describe.skipIf(!url)("feature rules", () => {
  let db: pg.Client;
  let as: ReturnType<typeof asUser>;
  let pub = { id: "", code: "" };
  let priv = { id: "", code: "" };

  beforeAll(async () => {
    db = await freshDb(url!);
    as = asUser(db);
    for (const [id, meta] of [
      [M, { username: "mestra", display_name: "Mestra" }],
      [P, { username: "jogador", display_name: "Jogador" }],
      [O, { username: "outra", display_name: "Outra" }],
      [G, { username: "convidado_z9", display_name: "Visita", is_guest: true }],
    ] as const) {
      await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, meta]);
      await as(id, "select ensure_profile()");
    }
    [pub] = await as<{ id: string; code: string }>(M, "select id, code from create_mesa($1, 'campanha', 'D&D 5.5', 'Aberta a todos', true, 'publica')", ["Taverna Aberta"]);
    [priv] = await as<{ id: string; code: string }>(M, "select id, code from create_mesa($1, 'campanha', 'D&D 5.5', 'Segredo', false, 'privada')", ["Cripta Fechada"]);
    await as(P, "select join_mesa($1)", [pub.code]);
  });

  afterAll(async () => {
    await db?.end();
  });

  describe("browser", () => {
    it("lists public and private tables to anyone, hiding private codes", async () => {
      const [r] = await as<{ b: { name: string; code: string | null; description: string; visibility: string }[] }>(null, "select browse_mesas() as b");
      const byName = Object.fromEntries(r.b.map((m) => [m.name, m]));
      expect(byName["Taverna Aberta"]).toMatchObject({ visibility: "publica", code: pub.code, description: "Aberta a todos" });
      expect(byName["Cripta Fechada"]).toMatchObject({ visibility: "privada", code: null, description: "" });
    });

    it("shows the code of private tables to their members", async () => {
      const [r] = await as<{ b: { name: string; code: string | null; my_role: string | null }[] }>(M, "select browse_mesas('', 'privada') as b");
      expect(r.b).toHaveLength(1);
      expect(r.b[0]).toMatchObject({ name: "Cripta Fechada", code: priv.code, my_role: "mestre" });
    });

    it("searches by name, system and master, and filters my tables", async () => {
      const q = async (uid: string | null, query: string, filter = "todas") =>
        (await as<{ b: { name: string }[] }>(uid, "select browse_mesas($1, $2) as b", [query, filter]))[0].b.map((m) => m.name);
      expect(await q(null, "taverna")).toEqual(["Taverna Aberta"]);
      expect(await q(null, "mestra")).toHaveLength(2);
      expect(await q(null, "%")).toEqual([]);
      expect(await q(P, "", "minhas")).toEqual(["Taverna Aberta"]);
      expect(await q(O, "", "minhas")).toEqual([]);
    });

    it("lets the master change visibility", async () => {
      await as(M, "update mesas set visibility = 'publica' where id = $1", [priv.id]);
      const [r] = await as<{ b: { name: string; code: string | null }[] }>(O, "select browse_mesas('cripta') as b");
      expect(r.b[0].code).toBe(priv.code);
      await as(M, "update mesas set visibility = 'privada' where id = $1", [priv.id]);
      await expect(as(M, "update mesas set visibility = 'secreta' where id = $1", [priv.id])).rejects.toThrow(/visibility_check/);
    });
  });

  describe("sheets", () => {
    let mine = "";
    let theirs = "";

    it("keeps sheets private to their owner", async () => {
      [{ id: mine }] = await as<{ id: string }>(P, "insert into fichas (name, data) values ('Thorkell', '{\"nivel\":3}') returning id");
      [{ id: theirs }] = await as<{ id: string }>(O, "insert into fichas (name, system) values ('Astrid', 'livre') returning id");
      expect(await as(O, "select id from fichas where id = $1", [mine])).toHaveLength(0);
      expect(await as(M, "select id from fichas where id = $1", [mine])).toHaveLength(0);
      expect(await as(P, "select id from fichas")).toHaveLength(1);
      expect(await as(O, "update fichas set name = 'x' where id = $1 returning id", [mine])).toHaveLength(0);
      await expect(as(P, "insert into fichas (owner_id, name) values ($1, 'falsa')", [O])).rejects.toThrow(/permission denied|row-level/);
    });

    it("shares a linked sheet with the master of that table only", async () => {
      await as(P, "update mesa_members set ficha_id = $1 where mesa_id = $2 and user_id = $3", [mine, pub.id, P]);
      const seen = await as<{ name: string; updated_at: string }>(M, "select name, updated_at from fichas where id = $1", [mine]);
      expect(seen).toHaveLength(1);
      expect(await as(O, "select id from fichas where id = $1", [mine])).toHaveLength(0);
      // the master cannot edit it
      expect(await as(M, "update fichas set name = 'x' where id = $1 returning id", [mine])).toHaveLength(0);
      const [state] = await as<{ s: { members: { user_id: string; ficha_id: string | null }[] } }>(M, "select mesa_state($1) as s", [pub.id]);
      expect(state.s.members.find((m) => m.user_id === P)?.ficha_id).toBe(mine);
    });

    it("refuses to link someone else's sheet", async () => {
      await expect(as(P, "update mesa_members set ficha_id = $1 where mesa_id = $2 and user_id = $3", [theirs, pub.id, P])).rejects.toThrow(/não é sua/);
    });

    it("bumps updated_at on save", async () => {
      const [before] = await as<{ updated_at: Date }>(P, "select updated_at from fichas where id = $1", [mine]);
      await new Promise((r) => setTimeout(r, 15));
      const [after] = await as<{ updated_at: Date }>(P, "update fichas set data = '{\"nivel\":4}' where id = $1 returning updated_at", [mine]);
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });

    it("protects uploaded files by folder and by sheet", async () => {
      const path = `${P}/${mine}/ficha.pdf`;
      await as(P, "insert into storage.objects (bucket_id, name) values ('fichas', $1)", [path]);
      await expect(as(P, "insert into storage.objects (bucket_id, name) values ('fichas', $1)", [`${O}/x/roubo.pdf`])).rejects.toThrow(/row-level/);
      expect(await as(M, "select name from storage.objects where name = $1", [path])).toHaveLength(0);
      await as(P, "update fichas set attachment_path = $1, attachment_kind = 'pdf' where id = $2", [path, mine]);
      expect(await as(M, "select name from storage.objects where name = $1", [path])).toHaveLength(1);
      expect(await as(O, "select name from storage.objects where name = $1", [path])).toHaveLength(0);
    });
  });

  describe("music", () => {
    let musica = "";
    let playlist = "";

    it("keeps the library and playlists private", async () => {
      [{ id: musica }] = await as<{ id: string }>(M, "insert into musicas (titulo, url, tipo) values ('Taverna', 'https://exemplo.com/t.mp3', 'audio') returning id");
      const [{ id: m2 }] = await as<{ id: string }>(M, "insert into musicas (titulo, url, tipo, youtube_id) values ('Batalha', 'https://youtu.be/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ') returning id");
      [{ id: playlist }] = await as<{ id: string }>(M, "insert into playlists (nome) values ('Combate') returning id");
      await as(M, "insert into playlist_musicas (playlist_id, musica_id, posicao) values ($1, $2, 1), ($1, $3, 2)", [playlist, musica, m2]);
      await as(M, "select playlist_reordenar($1, $2::uuid[])", [playlist, [m2, musica]]);
      const order = await as<{ musica_id: string }>(M, "select musica_id from playlist_musicas where playlist_id = $1 order by posicao", [playlist]);
      expect(order.map((r) => r.musica_id)).toEqual([m2, musica]);
      expect(await as(P, "select id from musicas")).toHaveLength(0);
      expect(await as(P, "select id from playlists")).toHaveLength(0);
      await expect(as(P, "insert into playlist_musicas (playlist_id, musica_id) values ($1, $2)", [playlist, musica])).rejects.toThrow(/row-level/);
      await expect(as(M, "insert into musicas (titulo, url, tipo) values ('x', 'javascript:alert(1)', 'audio')")).rejects.toThrow(/check/);
    });

    it("lets only the master control the table's sound, and members hear it", async () => {
      await expect(as(P, "select som_controlar($1, 'musica', 'tocar', $2)", [pub.id, JSON.stringify({ faixa: track(1) })])).rejects.toThrow(/mestre/);
      // a refused action on a channel that never played leaves no row behind
      await expect(as(M, "select som_controlar($1, 'musica', 'continuar', '{}')", [pub.id])).rejects.toThrow(/Nada para tocar/);
      expect(await as(M, "select 1 from mesa_som where mesa_id = $1", [pub.id])).toHaveLength(0);
      const [s] = await as<{ tocando: boolean; faixa: { titulo: string }; fila_idx: number; versao: string }>(
        M,
        "select * from som_controlar($1, 'musica', 'tocar', $2)",
        [pub.id, JSON.stringify({ fila: [track(1), track(2), track(3)], idx: 1 })],
      );
      expect(s).toMatchObject({ tocando: true, fila_idx: 1, faixa: { titulo: "Faixa 2" } });
      expect(Number(s.versao)).toBe(1);
      const heard = await as<{ canal: string; tocando: boolean }>(P, "select canal, tocando from mesa_som where mesa_id = $1", [pub.id]);
      expect(heard).toEqual([{ canal: "musica", tocando: true }]);
      expect(await as(O, "select canal from mesa_som")).toHaveLength(0);
      await expect(as(M, "select som_controlar($1, 'musica', 'tocar', $2)", [pub.id, JSON.stringify({ faixa: { titulo: "x", url: "ftp://a", tipo: "audio" } })])).rejects.toThrow(
        /inválida/,
      );
    });

    it("keeps time while paused and moves through the queue", async () => {
      const run = async (acao: string, dados: object = {}) =>
        (await as<{ tocando: boolean; posicao: number; fila_idx: number; faixa: { titulo: string } | null; repetir: boolean }>(
          M,
          "select * from som_controlar($1, 'musica', $2, $3)",
          [pub.id, acao, JSON.stringify(dados)],
        ))[0];
      await new Promise((r) => setTimeout(r, 250));
      const paused = await run("pausar");
      expect(paused.tocando).toBe(false);
      expect(paused.posicao).toBeGreaterThan(0.2);
      await new Promise((r) => setTimeout(r, 200));
      const still = await run("volume", { valor: 0.5 });
      expect(Math.abs(still.posicao - paused.posicao)).toBeLessThan(0.01);
      expect((await run("continuar")).tocando).toBe(true);
      expect((await run("buscar", { posicao: 30 })).posicao).toBe(30);
      expect((await run("proxima")).fila_idx).toBe(2);
      // the last track ends and the queue does not repeat: stop at the start
      const end = await run("proxima", { fim: true });
      expect(end).toMatchObject({ tocando: false, fila_idx: 0, faixa: { titulo: "Faixa 1" } });
      await run("repetir", { valor: true });
      await run("tocar", { fila: [track(1), track(2)], idx: 1 });
      expect(await run("proxima", { fim: true })).toMatchObject({ tocando: true, fila_idx: 0 });
      expect((await run("anterior")).fila_idx).toBe(1);
      expect(await run("parar")).toMatchObject({ tocando: false, faixa: null });
      // every change bumps the version, so clients can drop late updates
      const [{ versao }] = await as<{ versao: string }>(M, "select versao from mesa_som where mesa_id = $1 and canal = 'musica'", [pub.id]);
      expect(Number(versao)).toBe(12);
    });

    it("plays ambience on its own channel, looping by default", async () => {
      const [a] = await as<{ canal: string; repetir: boolean }>(M, "select * from som_controlar($1, 'ambiente', 'tocar', $2)", [pub.id, JSON.stringify({ faixa: track(9) })]);
      expect(a).toMatchObject({ canal: "ambiente", repetir: true });
    });

    it("gives everyone the server clock", async () => {
      const [r] = await as<{ t: Date }>(null, "select server_time() as t");
      expect(Math.abs(r.t.getTime() - Date.now())).toBeLessThan(5000);
    });
  });

  describe("initiative", () => {
    type Estado = { ativo: boolean; rodada: number; turno: string | null; combatentes: { id: string; nome: string; pv: number | null; estado: string | null; user_id: string | null }[] };
    const estado = async (uid: string) => (await as<{ e: Estado }>(uid, "select iniciativa_estado($1) as e", [pub.id]))[0].e;

    it("lets the master add creatures and players join with their roll", async () => {
      await as(M, "insert into combatentes (mesa_id, nome, iniciativa, pv, pv_max, ca, oculto) values ($1, 'Draugr', 12, 20, 30, 14, true)", [pub.id]);
      await as(M, "insert into combatentes (mesa_id, nome, iniciativa, pv, pv_max) values ($1, 'Lobo', 8, 11, 11)", [pub.id]);
      await expect(as(P, "insert into combatentes (mesa_id, nome) values ($1, 'trapaça')", [pub.id])).rejects.toThrow(/row-level/);
      const [{ e }] = await as<{ e: Estado }>(P, "select iniciativa_entrar($1, 17, 2) as e", [pub.id]);
      expect(e.combatentes.map((c) => c.nome)).toEqual(["Jogador", "Draugr", "Lobo"]);
      // joining again updates the same entry
      await as(P, "select iniciativa_entrar($1, 5, 2)", [pub.id]);
      expect((await estado(P)).combatentes.map((c) => c.nome)).toEqual(["Draugr", "Lobo", "Jogador"]);
      await expect(as(O, "select iniciativa_entrar($1, 10)", [pub.id])).rejects.toThrow(/não está nesta mesa/);
    });

    it("hides the hit points of hidden creatures from players", async () => {
      const p = await estado(P);
      const draugr = p.combatentes.find((c) => c.nome === "Draugr")!;
      expect(draugr.pv).toBeNull();
      expect(draugr.estado).toBe("ferido");
      expect(p.combatentes.find((c) => c.nome === "Lobo")!.pv).toBe(11);
      expect((await estado(M)).combatentes.find((c) => c.nome === "Draugr")!.pv).toBe(20);
      expect(await as(P, "select id from combatentes")).toHaveLength(0);
    });

    it("runs turns and rounds", async () => {
      await expect(as(P, "select combate_controlar($1, 'iniciar')", [pub.id])).rejects.toThrow(/mestre/);
      const nome = (e: Estado) => e.combatentes.find((c) => c.id === e.turno)?.nome;
      const step = async (acao: string) => (await as<{ e: Estado }>(M, "select combate_controlar($1, $2) as e", [pub.id, acao]))[0].e;
      let e = await step("iniciar");
      expect([e.ativo, e.rodada, nome(e)]).toEqual([true, 1, "Draugr"]);
      e = await step("proximo");
      e = await step("proximo");
      expect([e.rodada, nome(e)]).toEqual([1, "Jogador"]);
      e = await step("proximo");
      expect([e.rodada, nome(e)]).toEqual([2, "Draugr"]);
      e = await step("anterior");
      expect([e.rodada, nome(e)]).toEqual([1, "Jogador"]);
      e = await step("encerrar");
      expect([e.ativo, e.turno]).toEqual([false, null]);
      const seen = await as<{ versao: string }>(P, "select versao from mesa_combate where mesa_id = $1", [pub.id]);
      expect(Number(seen[0].versao)).toBeGreaterThan(3);
      e = await step("limpar");
      expect(e.combatentes).toEqual([]);
    });
  });

  describe("notes", () => {
    it("are for the master only", async () => {
      await as(M, "select notas_salvar($1, 'O traidor é o ferreiro.')", [pub.id]);
      await as(M, "select notas_salvar($1, 'O traidor é o ferreiro. E a rainha sabe.')", [pub.id]);
      expect((await as<{ texto: string }>(M, "select texto from mesa_notas where mesa_id = $1", [pub.id]))[0].texto).toMatch(/rainha/);
      expect(await as(P, "select texto from mesa_notas")).toHaveLength(0);
      await expect(as(P, "select notas_salvar($1, 'hack')", [pub.id])).rejects.toThrow(/mestre/);
    });
  });

  it("deleting a table removes its sound, combat and notes", async () => {
    await as(M, "insert into combatentes (mesa_id, nome) values ($1, 'Troll')", [pub.id]);
    await as(M, "delete from mesas where id = $1", [pub.id]);
    for (const t of ["mesa_som", "mesa_combate", "combatentes", "mesa_notas"]) {
      const { rows } = await db.query(`select count(*)::int n from ${t} where mesa_id = $1`, [pub.id]);
      expect(rows[0].n).toBe(0);
    }
    // the player's sheet survives, unlinked
    const { rows } = await db.query("select count(*)::int n from fichas where owner_id = $1", [P]);
    expect(rows[0].n).toBe(1);
  });
});
