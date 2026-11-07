-- Minimal stand-in for the parts of a Supabase database the migration touches.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase grants everything on new public tables by default; mimic it so the migration's revokes are tested
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;

-- Minimal Storage schema so the bucket and its policies can be tested.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
