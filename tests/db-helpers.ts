import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const root = path.resolve(__dirname, "..");

/** Creates a fresh database with the Supabase stub and every migration applied. */
export async function freshDb(url: string): Promise<pg.Client> {
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const dbName = url.split("/").pop()!;
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  db.on("notice", () => {});
  await db.query(readFileSync(path.join(root, "tests/sql/supabase-stub.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.query(readFileSync(path.join(dir, f), "utf8"));
  return db;
}

/** Runs one statement as a signed-in user, the way PostgREST does (SET ROLE + JWT claims). */
export function asUser(db: pg.Client) {
  return async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await db.query("begin");
    try {
      await db.query(`set local role ${uid ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows as T[];
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };
}
