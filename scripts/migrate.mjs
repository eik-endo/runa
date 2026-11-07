#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to the Postgres database linked by the
 * Vercel ↔ Supabase integration (POSTGRES_URL_NON_POOLING / POSTGRES_URL).
 * Runs before `next build`. Every migration is idempotent; a file is applied
 * again whenever its content changes.
 *
 *   node scripts/migrate.mjs           # warn and continue if there is no database
 *   node scripts/migrate.mjs --strict  # fail when the database is unreachable
 *
 * Set SKIP_DB_MIGRATIONS=1 to skip.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const strict = process.argv.includes("--strict");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");
const log = (msg) => console.log(`[runa:migrações] ${msg}`);

if (process.env.SKIP_DB_MIGRATIONS) {
  log("SKIP_DB_MIGRATIONS definido: nada a fazer.");
  process.exit(0);
}

const candidates = [
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.POSTGRES_URL,
  process.env.SUPABASE_DB_URL,
  process.env.DATABASE_URL,
].filter(Boolean);

if (!candidates.length) {
  log("Nenhum banco configurado (POSTGRES_URL). Pulando migrações; o rolador solo funciona sem banco.");
  process.exit(0);
}

function clientFor(raw) {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  // Supabase uses its own CA; connect with TLS but without CA verification.
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "supa", "pgbouncer", "uselibpqcompat"]) url.searchParams.delete(k);
  return new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
  });
}

let client = null;
for (const raw of candidates) {
  const c = clientFor(raw);
  c.on("notice", (n) => log(`aviso do banco: ${n.message}`));
  try {
    await c.connect();
    client = c;
    log(`Conectado em ${new URL(raw).hostname}.`);
    break;
  } catch (e) {
    log(`Não conectou em ${new URL(raw).hostname}: ${e.message}`);
    await c.end().catch(() => {});
  }
}

if (!client) {
  const msg = "Não foi possível conectar ao banco. Rode o SQL de supabase/migrations no SQL Editor do Supabase.";
  if (strict) {
    console.error(`[runa:migrações] ${msg}`);
    process.exit(1);
  }
  log(msg);
  process.exit(0);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

try {
  await client.query("create schema if not exists runa_private");
  await client.query("revoke all on schema runa_private from public");
  await client.query(
    "create table if not exists runa_private.migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())",
  );
  const { rows } = await client.query("select name, checksum from runa_private.migrations");
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const sum = createHash("sha256").update(sql).digest("hex");
    if (applied.get(file) === sum) {
      log(`${file}: já aplicado.`);
      continue;
    }
    log(`${file}: aplicando…`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into runa_private.migrations (name, checksum) values ($1, $2) on conflict (name) do update set checksum = excluded.checksum, applied_at = now()",
        [file, sum],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw new Error(`${file}: ${e.message}`);
    }
    log(`${file}: pronto.`);
  }
  log("Banco em dia.");
} catch (e) {
  console.error(`[runa:migrações] Falhou: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
