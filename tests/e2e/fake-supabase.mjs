#!/usr/bin/env node
/**
 * A small stand-in for the Supabase APIs this app uses, for end-to-end tests
 * on a laptop without Docker. It runs the real migration on a real PostgreSQL
 * and enforces row level security exactly like Supabase does (SET ROLE + JWT
 * claims), so the database rules under test are the production ones.
 *
 *   Auth:     password sign-in, refresh, /user, admin create/update user
 *   REST:     /rest/v1/rpc/<fn>, select / insert / upsert / update / delete with eq/is filters
 *   Storage:  upload (multipart), signed URLs, remove — objects rows go through the real storage RLS
 *   Realtime: Phoenix protocol 2.0.0 (postgres_changes with RLS check, presence)
 *
 * Usage: DATABASE_URL=postgres://postgres@127.0.0.1:54322/runa_e2e node tests/e2e/fake-supabase.mjs
 * Prints the anon and service keys to use as env vars for the app.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { WebSocketServer } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54322/runa_e2e";
const PORT = Number(process.env.PORT || 54321);
const SECRET = "fake-supabase-secret-for-tests-only";

// ------------------------------------------------------------------ jwt

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [h, b, s] = token.split(".");
  if (!s) return null;
  const expect = createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (expect !== s) return null;
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const ANON = sign({ role: "anon", iss: "fake", iat: 1700000000, exp: 4000000000 });
const SERVICE = sign({ role: "service_role", iss: "fake", iat: 1700000000, exp: 4000000000 });

// ------------------------------------------------------------------ database

const admin = new pg.Pool({ connectionString: DB, max: 8 });

async function setupDatabase() {
  const u = new URL(DB);
  const name = u.pathname.slice(1);
  u.pathname = "/postgres";
  const sys = new pg.Client({ connectionString: u.toString() });
  await sys.connect();
  if (process.env.RESET !== "0") {
    await sys.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
    await sys.query(`drop database if exists ${name}`);
    await sys.query(`create database ${name}`);
  }
  await sys.end();
  const c = await admin.connect();
  try {
    await c.query(readFileSync(path.join(root, "tests/sql/supabase-stub.sql"), "utf8"));
    await c.query("alter table auth.users add column if not exists password_hash text");
    await c.query("alter table auth.users add column if not exists created_at timestamptz default now()");
    const dir = path.join(root, "supabase/migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await c.query(readFileSync(path.join(dir, f), "utf8"));
    await c.query(`
      create or replace function public._fake_realtime() returns trigger language plpgsql as $$
      begin
        perform pg_notify('fake_realtime', json_build_object(
          'table', tg_table_name, 'type', tg_op,
          'record', case when tg_op = 'DELETE' then null else row_to_json(new) end,
          'old', case when tg_op = 'INSERT' then null else row_to_json(old) end)::text);
        return null;
      end $$;
      do $$ declare t text; begin
        foreach t in array array['rolls','mesa_members','custom_dice','mesa_som','mesa_combate','fichas'] loop
          execute format('drop trigger if exists _fake_rt on public.%I', t);
          execute format('create trigger _fake_rt after insert or update or delete on public.%I for each row execute function public._fake_realtime()', t);
        end loop;
      end $$;`);
  } finally {
    c.release();
  }
}

/** Runs SQL as the role in the request's JWT, like PostgREST. */
async function asRole(claims, fn) {
  const c = await admin.connect();
  try {
    await c.query("begin");
    const role = ["anon", "authenticated", "service_role"].includes(claims?.role) ? claims.role : "anon";
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ------------------------------------------------------------------ http helpers

function send(res, status, body, headers = {}) {
  const h = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version, x-region, x-upsert, cache-control, x-metadata",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "content-range, x-supabase-api-version",
    ...headers,
  };
  if (body === undefined || status === 204) {
    res.writeHead(status, h);
    return res.end();
  }
  res.writeHead(status, { "content-type": "application/json", ...h });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.headers.apikey;

function pgError(res, e) {
  const code = e.code || "XX000";
  let status = 400;
  if (code === "42501") status = 403;
  else if (code === "P0002") status = 404;
  else if (code === "28000") status = 401;
  else if (code === "23505") status = 409;
  send(res, status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

// ------------------------------------------------------------------ auth

const hashPw = (pw) => createHash("sha256").update(`fake:${pw}`).digest("hex");
const refreshTokens = new Map();

function userJson(row) {
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: row.created_at,
    phone: "",
    confirmed_at: row.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: row.created_at,
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}

function session(row) {
  const now = Math.floor(Date.now() / 1000);
  const user = userJson(row);
  const access = sign({
    sub: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    iat: now,
    exp: now + 3600,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata,
    session_id: randomUUID(),
  });
  const refresh = randomBytes(16).toString("hex");
  refreshTokens.set(refresh, row.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
}

async function handleAuth(req, res, url, sub) {
  const claims = verify(bearer(req));
  if (sub === "/token" && req.method === "POST") {
    const body = await readBody(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await admin.query("select * from auth.users where lower(email) = lower($1)", [body.email ?? ""]);
      if (!rows[0] || rows[0].password_hash !== hashPw(body.password ?? ""))
        return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(rows[0]));
    }
    if (grant === "refresh_token") {
      const id = refreshTokens.get(body.refresh_token);
      if (!id) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      const { rows } = await admin.query("select * from auth.users where id = $1", [id]);
      return send(res, 200, session(rows[0]));
    }
    return send(res, 400, { msg: "unsupported grant_type" });
  }
  if (sub === "/user" && req.method === "GET") {
    if (!claims?.sub) return send(res, 401, { code: 401, msg: "invalid JWT" });
    const { rows } = await admin.query("select * from auth.users where id = $1", [claims.sub]);
    if (!rows[0]) return send(res, 404, { msg: "User not found" });
    return send(res, 200, userJson(rows[0]));
  }
  if (sub === "/logout") return send(res, 204);
  if (sub.startsWith("/admin/users")) {
    if (claims?.role !== "service_role") return send(res, 403, { msg: "User not allowed" });
    const body = req.method === "GET" ? {} : await readBody(req);
    const id = sub.split("/")[3];
    if (req.method === "POST" && !id) {
      const email = String(body.email ?? "").toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { code: 400, error_code: "validation_failed", msg: "Unable to validate email address: invalid format" });
      const dupe = await admin.query("select 1 from auth.users where lower(email) = $1", [email]);
      if (dupe.rowCount) return send(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const { rows } = await admin.query(
        "insert into auth.users (id, email, raw_user_meta_data, password_hash) values ($1, $2, $3, $4) returning *",
        [randomUUID(), email, body.user_metadata ?? {}, body.password ? hashPw(body.password) : null],
      );
      return send(res, 200, userJson(rows[0]));
    }
    if (req.method === "PUT" && id) {
      const email = body.email ? String(body.email).toLowerCase() : null;
      if (email) {
        const dupe = await admin.query("select 1 from auth.users where lower(email) = $1 and id <> $2", [email, id]);
        if (dupe.rowCount) return send(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      }
      const { rows } = await admin.query(
        `update auth.users set email = coalesce($2, email), raw_user_meta_data = coalesce($3, raw_user_meta_data),
         password_hash = coalesce($4, password_hash) where id = $1 returning *`,
        [id, email, body.user_metadata ?? null, body.password ? hashPw(body.password) : null],
      );
      if (!rows[0]) return send(res, 404, { msg: "User not found" });
      return send(res, 200, userJson(rows[0]));
    }
  }
  return send(res, 404, { msg: `not implemented: ${req.method} /auth/v1${sub}` });
}

// ------------------------------------------------------------------ rest

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: "42601" });
  return `"${s}"`;
};
const TABLES = new Set([
  "profiles",
  "mesas",
  "mesa_members",
  "rolls",
  "custom_dice",
  "fichas",
  "musicas",
  "playlists",
  "playlist_musicas",
  "mesa_som",
  "mesa_combate",
  "combatentes",
  "mesa_notas",
]);

function whereFrom(url, params) {
  const parts = [];
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const m = /^(eq|neq|is|gt|lt|gte|lte)\.(.*)$/.exec(v);
    if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { code: "PGRST100" });
    const [, op, val] = m;
    if (op === "is") parts.push(`${ident(k)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
    else {
      params.push(val);
      const sym = { eq: "=", neq: "<>", gt: ">", lt: "<", gte: ">=", lte: "<=" }[op];
      parts.push(`${ident(k)} ${sym} $${params.length}`);
    }
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

const ARG_TYPES = new Map();
/** name -> type of each argument of public.<fn> (all overloads merged). */
async function argTypes(fn) {
  if (!ARG_TYPES.has(fn)) {
    const { rows } = await admin.query(
      `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    const map = new Map();
    for (const r of rows) (r.names ?? []).forEach((name, i) => r.types[i] && map.set(name, r.types[i]));
    ARG_TYPES.set(fn, map);
  }
  return ARG_TYPES.get(fn);
}

function selectList(url) {
  const s = url.searchParams.get("select");
  if (!s || s === "*") return "*";
  return s
    .split(",")
    .map((c) => ident(c.trim()))
    .join(", ");
}

function wantsObject(req) {
  return (req.headers.accept || "").includes("application/vnd.pgrst.object+json");
}

function respondRows(req, res, rows, status = 200) {
  if (wantsObject(req)) {
    if (rows.length !== 1)
      return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
    return send(res, status, rows[0]);
  }
  return send(res, status, rows);
}

async function handleRest(req, res, url, sub) {
  const claims = verify(bearer(req));
  if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT invalid" });
  const prefer = req.headers.prefer || "";
  try {
    if (sub.startsWith("/rpc/")) {
      const fn = sub.slice(5);
      const args = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams);
      const names = Object.keys(args);
      const types = await argTypes(fn);
      const params = names.map((n) => {
        const v = args[n];
        if (v === null || v === undefined) return null;
        // PostgREST hands arrays to array parameters as arrays and everything else as JSON.
        if (Array.isArray(v) && types.get(n)?.endsWith("[]")) return v;
        return typeof v === "object" ? JSON.stringify(v) : String(v);
      });
      const call = `public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")})`;
      const out = await asRole(claims, (c) => c.query(`select to_jsonb(${call}) as result`, params));
      return send(res, 200, out.rows[0].result);
    }
    const table = sub.slice(1);
    if (!TABLES.has(table)) return send(res, 404, { code: "PGRST205", message: `Could not find the table 'public.${table}'` });
    const t = `public.${ident(table)}`;
    if (req.method === "GET") {
      const params = [];
      let sql = `select ${selectList(url)} from ${t}${whereFrom(url, params)}`;
      const order = url.searchParams.get("order");
      if (order) {
        sql +=
          " order by " +
          order
            .split(",")
            .map((o) => {
              const [col, dir] = o.split(".");
              return `${ident(col)} ${dir === "desc" ? "desc" : "asc"}`;
            })
            .join(", ");
      }
      const limit = url.searchParams.get("limit");
      if (limit) sql += ` limit ${parseInt(limit, 10)}`;
      const out = await asRole(claims, (c) => c.query(sql, params));
      return respondRows(req, res, out.rows);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const params = [];
      const values = rows
        .map(
          (r) =>
            `(${cols
              .map((col) => {
                const v = r[col];
                params.push(v === undefined ? null : v !== null && typeof v === "object" ? JSON.stringify(v) : v);
                return `$${params.length}`;
              })
              .join(", ")})`,
        )
        .join(", ");
      let sql = `insert into ${t} (${cols.map(ident).join(", ")}) values ${values}`;
      const conflict = url.searchParams.get("on_conflict");
      if (prefer.includes("resolution=merge-duplicates")) {
        sql += ` on conflict (${(conflict || "id").split(",").map(ident).join(", ")}) do update set ${cols.map((col) => `${ident(col)} = excluded.${ident(col)}`).join(", ")}`;
      } else if (prefer.includes("resolution=ignore-duplicates")) sql += " on conflict do nothing";
      const returning = prefer.includes("return=representation");
      if (returning) sql += ` returning ${selectList(url)}`;
      const out = await asRole(claims, (c) => c.query(sql, params));
      return returning ? respondRows(req, res, out.rows, 201) : send(res, 201);
    }
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const params = [];
      const sets = Object.entries(body).map(([k, v]) => {
        params.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v);
        return `${ident(k)} = $${params.length}`;
      });
      let sql = `update ${t} set ${sets.join(", ")}${whereFrom(url, params)}`;
      const returning = prefer.includes("return=representation");
      if (returning) sql += ` returning ${selectList(url)}`;
      const out = await asRole(claims, (c) => c.query(sql, params));
      return returning ? respondRows(req, res, out.rows) : send(res, 204);
    }
    if (req.method === "DELETE") {
      const params = [];
      let sql = `delete from ${t}${whereFrom(url, params)}`;
      const returning = prefer.includes("return=representation");
      if (returning) sql += ` returning ${selectList(url)}`;
      const out = await asRole(claims, (c) => c.query(sql, params));
      return returning ? respondRows(req, res, out.rows) : send(res, 204);
    }
    return send(res, 405, { message: "method not allowed" });
  } catch (e) {
    return pgError(res, e);
  }
}

// ------------------------------------------------------------------ storage

/** `${bucket}/${name}` -> { type, data }. The rows live in storage.objects, under its RLS. */
const FILES = new Map();
const storageError = (res, status, error, message) => send(res, status, { statusCode: String(status), error, message });

async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks);
}

async function handleStorage(req, res, url, sub) {
  const signed = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(sub);
  if (signed && req.method === "GET") {
    const key = `${signed[1]}/${decodeURIComponent(signed[2])}`;
    const t = verify(url.searchParams.get("token"));
    if (!t || t.url !== key) return storageError(res, 400, "InvalidJWT", "invalid signature");
    const f = FILES.get(key);
    if (!f) return storageError(res, 404, "not_found", "Object not found");
    res.writeHead(200, { "content-type": f.type, "content-length": f.data.length, "access-control-allow-origin": "*" });
    return res.end(f.data);
  }
  const claims = verify(bearer(req));
  if (!claims) return storageError(res, 400, "Unauthorized", "Invalid JWT");
  try {
    if (signed && req.method === "POST") {
      const [, bucket, raw] = signed;
      const name = decodeURIComponent(raw);
      const body = await readBody(req);
      const out = await asRole(claims, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
      if (!out.rowCount || !FILES.has(`${bucket}/${name}`)) return storageError(res, 400, "not_found", "Object not found");
      const token = sign({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60) });
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${name}?token=${token}` });
    }
    const object = /^\/object\/([^/]+)\/(.+)$/.exec(sub);
    if (object && req.method === "POST") {
      const [, bucket, raw] = object;
      const name = decodeURIComponent(raw);
      const b = await admin.query("select * from storage.buckets where id = $1", [bucket]);
      if (!b.rowCount) return storageError(res, 400, "Bucket not found", "Bucket not found");
      const ct = req.headers["content-type"] || "application/octet-stream";
      let data = await readRaw(req);
      let type = ct;
      if (ct.startsWith("multipart/form-data")) {
        const form = await new Request("http://local/", { method: "POST", headers: { "content-type": ct }, body: data }).formData();
        for (const [, v] of form) {
          if (typeof v !== "string") {
            data = Buffer.from(await v.arrayBuffer());
            type = v.type || "application/octet-stream";
          }
        }
      }
      const bucketRow = b.rows[0];
      if (bucketRow.file_size_limit && data.length > Number(bucketRow.file_size_limit))
        return storageError(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
      if (bucketRow.allowed_mime_types?.length && !bucketRow.allowed_mime_types.includes(type))
        return storageError(res, 415, "invalid_mime_type", `mime type ${type} is not supported`);
      try {
        const out = await asRole(claims, (c) => c.query("insert into storage.objects (bucket_id, name) values ($1, $2) returning id", [bucket, name]));
        FILES.set(`${bucket}/${name}`, { type, data });
        return send(res, 200, { Id: out.rows[0].id, Key: `${bucket}/${name}` });
      } catch (e) {
        if (e.code === "42501") return storageError(res, 403, "Unauthorized", "new row violates row-level security policy");
        throw e;
      }
    }
    const removeAll = /^\/object\/([^/]+)$/.exec(sub);
    if (removeAll && req.method === "DELETE") {
      const bucket = removeAll[1];
      const body = await readBody(req);
      const names = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
      const out = await asRole(claims, (c) => c.query("delete from storage.objects where bucket_id = $1 and name = any($2) returning name, bucket_id", [bucket, names]));
      for (const r of out.rows) FILES.delete(`${bucket}/${r.name}`);
      return send(res, 200, out.rows);
    }
    return storageError(res, 404, "not_found", `not implemented: ${req.method} /storage/v1${sub}`);
  } catch (e) {
    return storageError(res, 400, e.code || "error", e.message);
  }
}

// ------------------------------------------------------------------ realtime

/** topic -> Set<Sub>; Sub = { ws, joinRef, bindings, key, claims, meta, presenceEnabled } */
const topics = new Map();
let refCounter = 1;
const COLUMNS = new Map();

async function columnsOf(table) {
  if (!COLUMNS.has(table)) {
    const { rows } = await admin.query(
      "select column_name as name, udt_name as type from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
      [table],
    );
    COLUMNS.set(table, rows);
  }
  return COLUMNS.get(table);
}

const wsSend = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

function presenceState(topic) {
  const state = {};
  for (const s of topics.get(topic) ?? []) if (s.meta) state[s.key] = { metas: [s.meta] };
  return state;
}

function broadcastDiff(topic, joins, leaves) {
  for (const s of topics.get(topic) ?? []) if (s.presenceEnabled) wsSend(s.ws, [null, null, topic, "presence_diff", { joins, leaves }]);
}

function leave(topic, sub) {
  const set = topics.get(topic);
  if (!set) return;
  set.delete(sub);
  if (sub.meta) broadcastDiff(topic, {}, { [sub.key]: { metas: [sub.meta] } });
}

const PKS = new Map();
async function primaryKey(table) {
  if (!PKS.has(table)) {
    const { rows } = await admin.query(
      `select a.attname as name from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = format('public.%I', $1::text)::regclass and i.indisprimary`,
      [table],
    );
    PKS.set(table, rows.map((r) => r.name));
  }
  return PKS.get(table);
}

/** Like Supabase Realtime: a change only reaches subscribers whose RLS lets them see the row. */
async function visible(sub, table, record) {
  const pk = await primaryKey(table);
  if (!record || !pk.length || pk.some((k) => record[k] == null)) return false;
  try {
    const where = pk.map((k, i) => `${ident(k)} = $${i + 1}`).join(" and ");
    const out = await asRole(sub.claims ?? { role: "anon" }, (c) => c.query(`select 1 from public.${ident(table)} where ${where}`, pk.map((k) => record[k])));
    return out.rowCount > 0;
  } catch {
    return false;
  }
}

function matches(binding, table, type, record) {
  if (binding.schema && binding.schema !== "*" && binding.schema !== "public") return false;
  if (binding.table && binding.table !== "*" && binding.table !== table) return false;
  if (binding.event !== "*" && binding.event?.toUpperCase() !== type) return false;
  if (binding.filter) {
    const m = /^([a-z_]+)=eq\.(.*)$/.exec(binding.filter);
    if (!m) return false;
    if (String(record?.[m[1]]) !== m[2]) return false;
  }
  return true;
}

async function onChange(payload) {
  const { table, type } = payload;
  const record = payload.record ?? payload.old;
  const columns = await columnsOf(table);
  const pk = await primaryKey(table);
  const oldKeys = payload.old ? Object.fromEntries(pk.map((k) => [k, payload.old[k]])) : undefined;
  for (const [topic, subs] of topics) {
    for (const sub of subs) {
      const ids = sub.bindings.filter((b) => matches(b, table, type, record)).map((b) => b.id);
      if (!ids.length) continue;
      if (type !== "DELETE" && !(await visible(sub, table, record))) continue;
      wsSend(sub.ws, [
        null,
        null,
        topic,
        "postgres_changes",
        {
          ids,
          data: {
            schema: "public",
            table,
            commit_timestamp: new Date().toISOString(),
            type,
            record: payload.record ?? undefined,
            old_record: oldKeys,
            columns,
            errors: null,
          },
        },
      ]);
    }
  }
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    const mine = new Map(); // topic -> sub
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const [joinRef, ref, topic, event, payload] = msg;
      const reply = (response = {}, status = "ok") => wsSend(ws, [joinRef, ref, topic, "phx_reply", { status, response }]);
      if (topic === "phoenix" && event === "heartbeat") return reply();
      if (event === "phx_join") {
        const cfg = payload?.config ?? {};
        const bindings = (cfg.postgres_changes ?? []).map((b) => ({ ...b, id: refCounter++ }));
        const old = mine.get(topic);
        if (old) leave(topic, old);
        const sub = {
          ws,
          joinRef,
          bindings,
          key: cfg.presence?.key || randomUUID(),
          claims: verify(payload?.access_token),
          meta: null,
          presenceEnabled: !!cfg.presence?.enabled,
        };
        mine.set(topic, sub);
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(sub);
        reply({ postgres_changes: bindings.map(({ id, event: e, schema, table, filter }) => ({ id, event: e, schema, table, filter })) });
        if (sub.presenceEnabled) wsSend(ws, [joinRef, null, topic, "presence_state", presenceState(topic)]);
        return;
      }
      const sub = mine.get(topic);
      if (!sub) return reply({ reason: "unmatched topic" }, "error");
      if (event === "access_token") {
        sub.claims = verify(payload?.access_token) ?? sub.claims;
        return;
      }
      if (event === "presence") {
        if (payload?.event === "track") {
          const prev = sub.meta;
          sub.meta = { ...payload.payload, phx_ref: String(refCounter++) };
          broadcastDiff(topic, { [sub.key]: { metas: [sub.meta] } }, prev ? { [sub.key]: { metas: [prev] } } : {});
        } else if (payload?.event === "untrack" && sub.meta) {
          const prev = sub.meta;
          sub.meta = null;
          broadcastDiff(topic, {}, { [sub.key]: { metas: [prev] } });
        }
        return reply();
      }
      if (event === "phx_leave") {
        leave(topic, sub);
        mine.delete(topic);
        return reply();
      }
      return reply();
    });
    ws.on("close", () => {
      for (const [topic, sub] of mine) leave(topic, sub);
      mine.clear();
    });
  });
}

// ------------------------------------------------------------------ main

await setupDatabase();
const listener = new pg.Client({ connectionString: DB });
await listener.connect();
await listener.query("listen fake_realtime");
// one change at a time, in commit order, like Supabase Realtime
let queue = Promise.resolve();
listener.on("notification", (n) => {
  let payload;
  try {
    payload = JSON.parse(n.payload);
  } catch (e) {
    return console.error("realtime", e);
  }
  queue = queue.then(() => onChange(payload)).catch((e) => console.error("realtime", e));
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url, url.pathname.slice(8));
    if (url.pathname.startsWith("/rest/v1")) return await handleRest(req, res, url, url.pathname.slice(8));
    if (url.pathname.startsWith("/storage/v1")) return await handleStorage(req, res, url, url.pathname.slice(11));
    return send(res, 404, { message: "not found" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { message: String(e?.message ?? e) });
  }
});
attachRealtime(server);
server.listen(PORT, () => {
  console.log(`fake supabase on http://localhost:${PORT}`);
  console.log(`ANON_KEY=${ANON}`);
  console.log(`SERVICE_KEY=${SERVICE}`);
});
