// A real PostgreSQL in memory (PGlite) with the minimum of Supabase that the migrations rely on
// (roles, auth.users, auth.uid(), auth.jwt(), default grants). Used by the tests and by the local
// Supabase stand-in (scripts/dev-supabase.mjs). The SQL files in supabase/ run unmodified, in the
// same order as in production.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export function migrationFiles() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
}

export function readSql(file) {
  return fs.readFileSync(file, 'utf8');
}

export const LEGACY_SCHEMA = path.join(ROOT, 'supabase', 'schema.sql');

/** A database with Supabase stubs and the legacy schema (the state production was in before 0001). */
export async function createLegacyDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec(readSql(LEGACY_SCHEMA));
  return db;
}

export async function applyMigrations(db, { upTo } = {}) {
  for (const file of migrationFiles()) {
    if (upTo && path.basename(file) > upTo) break;
    await db.exec(readSql(file));
  }
}

/** A fully migrated, empty database. */
export async function createDb() {
  const db = await createLegacyDb();
  await applyMigrations(db);
  return db;
}

export async function createUser(db, email) {
  const { rows } = await db.query('insert into auth.users (email) values ($1) returning id, email', [email]);
  return rows[0];
}

export async function makeAdmin(db, user) {
  await db.query('insert into public.admins (user_id) values ($1) on conflict do nothing', [user.id]);
}

async function withRole(db, role, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

/** Runs fn as a signed-in user (role "authenticated", RLS applies), like a request with their JWT. */
export function asUser(db, user, fn) {
  return withRole(db, 'authenticated', { sub: user.id, email: user.email, role: 'authenticated' }, fn);
}

/** Runs fn as an anonymous visitor (role "anon"). */
export function asAnon(db, fn) {
  return withRole(db, 'anon', { role: 'anon' }, fn);
}

/** Runs fn as the server (service role, bypasses RLS). */
export function asService(db, fn) {
  return withRole(db, 'service_role', { role: 'service_role' }, fn);
}

/** Calls a function and returns its single value. */
export async function rpc(tx, name, args = {}) {
  const keys = Object.keys(args);
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !(args[k] instanceof Date) ? JSON.stringify(args[k]) : args[k]));
  const { rows } = await tx.query(`select public.${name}(${params}) as result`, values);
  return rows[0]?.result;
}

/** Expects a query to be rejected and returns the error. */
export async function rejected(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the query to fail, but it succeeded.');
}
