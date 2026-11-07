-- Runa: mesas de dados online
-- Idempotent: safe to run more than once (the build runs it on every deploy).

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  dice_color text not null default '#b8402f' check (dice_color ~ '^#[0-9a-fA-F]{6}$'),
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.mesas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'campanha' check (kind in ('campanha', 'avulsa')),
  system text not null default 'D&D 5.5' check (char_length(system) <= 60),
  description text not null default '' check (char_length(description) <= 4000),
  rune_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_roll_at timestamptz
);

create table if not exists public.mesa_members (
  mesa_id uuid not null references public.mesas (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'jogador' check (role in ('mestre', 'jogador')),
  character_name text not null default '' check (char_length(character_name) <= 60),
  character_notes text not null default '' check (char_length(character_notes) <= 4000),
  rune text check (rune is null or char_length(rune) <= 20),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  joined_at timestamptz not null default now(),
  primary key (mesa_id, user_id)
);

create index if not exists mesa_members_user_idx on public.mesa_members (user_id);

create table if not exists public.rolls (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  roller_name text not null,
  roller_color text not null,
  roller_rune text,
  label text check (label is null or char_length(label) <= 60),
  notation text not null check (char_length(notation) <= 400),
  groups jsonb not null,
  modifier integer not null default 0,
  seed integer not null,
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists rolls_mesa_created_idx on public.rolls (mesa_id, created_at desc);

create table if not exists public.custom_dice (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  mesa_id uuid references public.mesas (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  spec jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists custom_dice_owner_idx on public.custom_dice (owner_id);
create index if not exists custom_dice_mesa_idx on public.custom_dice (mesa_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.rand_int(n integer)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  r bigint;
  b bytea;
begin
  if n is null or n < 1 then
    raise exception 'invalid range';
  end if;
  lim := (4294967296 / n) * n;
  loop
    -- the first 4 bytes of a v4 uuid are fully random (pg_strong_random)
    b := uuid_send(gen_random_uuid());
    r := (get_byte(b, 0)::bigint << 24) | (get_byte(b, 1)::bigint << 16) | (get_byte(b, 2)::bigint << 8) | get_byte(b, 3)::bigint;
    if r < lim then
      return (r % n)::integer + 1;
    end if;
  end loop;
end;
$$;

create or replace function public.gen_mesa_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  b bytea;
begin
  loop
    b := uuid_send(gen_random_uuid());
    c := '';
    for i in 0..5 loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.mesas where code = c);
  end loop;
  return c;
end;
$$;

create or replace function public.is_mesa_member(p_mesa uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.mesa_members where mesa_id = p_mesa and user_id = auth.uid());
$$;

create or replace function public.is_mesa_master(p_mesa uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.mesas where id = p_mesa and owner_id = auth.uid());
$$;

create or replace function public.shares_mesa_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.mesa_members a
    join public.mesa_members b on a.mesa_id = b.mesa_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.mesas enable row level security;
alter table public.mesa_members enable row level security;
alter table public.rolls enable row level security;
alter table public.custom_dice enable row level security;

drop policy if exists "profiles: ver a si e a quem divide mesa" on public.profiles;
create policy "profiles: ver a si e a quem divide mesa" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_mesa_with(id));

drop policy if exists "profiles: editar o proprio" on public.profiles;
create policy "profiles: editar o proprio" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "mesas: membros veem" on public.mesas;
create policy "mesas: membros veem" on public.mesas
  for select to authenticated
  using (owner_id = auth.uid() or public.is_mesa_member(id));

drop policy if exists "mesas: mestre edita" on public.mesas;
create policy "mesas: mestre edita" on public.mesas
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "mesas: mestre apaga" on public.mesas;
create policy "mesas: mestre apaga" on public.mesas
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "membros: quem esta na mesa ve" on public.mesa_members;
create policy "membros: quem esta na mesa ve" on public.mesa_members
  for select to authenticated
  using (public.is_mesa_member(mesa_id));

drop policy if exists "membros: cada um edita o seu" on public.mesa_members;
create policy "membros: cada um edita o seu" on public.mesa_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "membros: sair ou remover" on public.mesa_members;
create policy "membros: sair ou remover" on public.mesa_members
  for delete to authenticated
  using (
    (user_id = auth.uid() and role <> 'mestre')
    or (public.is_mesa_master(mesa_id) and user_id <> auth.uid())
  );

drop policy if exists "rolagens: membros veem" on public.rolls;
create policy "rolagens: membros veem" on public.rolls
  for select to authenticated
  using (
    public.is_mesa_member(mesa_id)
    and (not is_private or user_id = auth.uid() or public.is_mesa_master(mesa_id))
  );

drop policy if exists "rolagens: mestre limpa" on public.rolls;
create policy "rolagens: mestre limpa" on public.rolls
  for delete to authenticated
  using (public.is_mesa_master(mesa_id));

drop policy if exists "dados: ver os seus e os da mesa" on public.custom_dice;
create policy "dados: ver os seus e os da mesa" on public.custom_dice
  for select to authenticated
  using (owner_id = auth.uid() or (mesa_id is not null and public.is_mesa_member(mesa_id)));

drop policy if exists "dados: criar" on public.custom_dice;
create policy "dados: criar" on public.custom_dice
  for insert to authenticated
  with check (owner_id = auth.uid() and (mesa_id is null or public.is_mesa_master(mesa_id)));

drop policy if exists "dados: apagar" on public.custom_dice;
create policy "dados: apagar" on public.custom_dice
  for delete to authenticated
  using (owner_id = auth.uid() or (mesa_id is not null and public.is_mesa_master(mesa_id)));

-- ---------------------------------------------------------------- privileges

revoke all on table public.profiles, public.mesas, public.mesa_members, public.rolls, public.custom_dice from anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles, public.mesas, public.mesa_members, public.rolls, public.custom_dice to authenticated;
grant update (display_name, dice_color) on table public.profiles to authenticated;
grant update (name, system, description, rune_system) on table public.mesas to authenticated;
grant delete on table public.mesas to authenticated;
grant update (character_name, character_notes, rune, color) on table public.mesa_members to authenticated;
grant delete on table public.mesa_members to authenticated;
grant delete on table public.rolls to authenticated;
grant insert (mesa_id, name, spec) on table public.custom_dice to authenticated;
grant delete on table public.custom_dice to authenticated;

-- ---------------------------------------------------------------- functions called by the app

create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  meta jsonb;
  uname text;
  dname text;
begin
  if uid is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = uid;
  if found then
    return p;
  end if;
  select coalesce(raw_user_meta_data, '{}'::jsonb) into meta from auth.users where id = uid;
  uname := lower(coalesce(nullif(meta ->> 'username', ''), 'jogador_' || substr(replace(uid::text, '-', ''), 1, 10)));
  if uname !~ '^[a-z0-9][a-z0-9_.-]{2,40}$' or exists (select 1 from public.profiles where username = uname) then
    uname := 'jogador_' || substr(replace(uid::text, '-', ''), 1, 10);
  end if;
  dname := left(coalesce(nullif(trim(meta ->> 'display_name'), ''), uname), 40);
  insert into public.profiles (id, username, display_name, is_guest)
  values (uid, uname, dname, coalesce((meta ->> 'is_guest')::boolean, false))
  on conflict (id) do nothing;
  select * into p from public.profiles where id = uid;
  return p;
end;
$$;

create or replace function public.create_mesa(
  p_name text,
  p_kind text default 'campanha',
  p_system text default 'D&D 5.5',
  p_description text default '',
  p_rune_system boolean default false
)
returns public.mesas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  m public.mesas;
begin
  if uid is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  prof := public.ensure_profile();
  if prof.is_guest then
    raise exception 'Crie uma conta para abrir mesas.' using errcode = '42501';
  end if;
  if (select count(*) from public.mesas where owner_id = uid) >= 50 then
    raise exception 'Limite de 50 mesas por conta.' using errcode = '54000';
  end if;
  insert into public.mesas (code, owner_id, name, kind, system, description, rune_system)
  values (
    public.gen_mesa_code(),
    uid,
    left(coalesce(nullif(trim(p_name), ''), 'Mesa sem nome'), 80),
    case when p_kind = 'avulsa' then 'avulsa' else 'campanha' end,
    left(coalesce(nullif(trim(p_system), ''), 'D&D 5.5'), 60),
    left(coalesce(p_description, ''), 4000),
    coalesce(p_rune_system, false)
  )
  returning * into m;
  insert into public.mesa_members (mesa_id, user_id, role, color)
  values (m.id, uid, 'mestre', prof.dice_color);
  return m;
end;
$$;

create or replace function public.join_mesa(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  m public.mesas;
  r text;
begin
  if uid is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  prof := public.ensure_profile();
  select * into m from public.mesas where code = upper(trim(p_code));
  if not found then
    raise exception 'Não existe mesa com o código %.', upper(trim(p_code)) using errcode = 'P0002';
  end if;
  if (select count(*) from public.mesa_members where mesa_id = m.id) >= 40
     and not exists (select 1 from public.mesa_members where mesa_id = m.id and user_id = uid) then
    raise exception 'Esta mesa está cheia (40 pessoas).' using errcode = '54000';
  end if;
  insert into public.mesa_members (mesa_id, user_id, role, color)
  values (m.id, uid, case when m.owner_id = uid then 'mestre' else 'jogador' end, prof.dice_color)
  on conflict (mesa_id, user_id) do nothing;
  select role into r from public.mesa_members where mesa_id = m.id and user_id = uid;
  return jsonb_build_object('mesa', to_jsonb(m), 'role', r);
end;
$$;

create or replace function public.regenerate_code(p_mesa uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c text;
begin
  if not public.is_mesa_master(p_mesa) then
    raise exception 'Só o mestre pode trocar o código.' using errcode = '42501';
  end if;
  c := public.gen_mesa_code();
  update public.mesas set code = c, updated_at = now() where id = p_mesa;
  return c;
end;
$$;

create or replace function public.my_mesas()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by sort_key desc), '[]'::jsonb)
  from (
    select
      coalesce(m.last_roll_at, m.created_at) as sort_key,
      jsonb_build_object(
        'id', m.id,
        'code', m.code,
        'name', m.name,
        'kind', m.kind,
        'system', m.system,
        'description', m.description,
        'rune_system', m.rune_system,
        'created_at', m.created_at,
        'last_roll_at', m.last_roll_at,
        'owner_id', m.owner_id,
        'owner_name', p.display_name,
        'role', mm.role,
        'character_name', mm.character_name,
        'character_notes', mm.character_notes,
        'rune', mm.rune,
        'color', mm.color,
        'members', (select count(*) from public.mesa_members c where c.mesa_id = m.id)
      ) as x
    from public.mesa_members mm
    join public.mesas m on m.id = mm.mesa_id
    join public.profiles p on p.id = m.owner_id
    where mm.user_id = auth.uid()
  ) s;
$$;

create or replace function public.mesa_state(p_mesa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.mesas;
  result jsonb;
begin
  if not public.is_mesa_member(p_mesa) then
    raise exception 'Você não está nesta mesa.' using errcode = '42501';
  end if;
  select * into m from public.mesas where id = p_mesa;
  select jsonb_build_object(
    'mesa', to_jsonb(m),
    'role', (select role from public.mesa_members where mesa_id = p_mesa and user_id = auth.uid()),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', mm.user_id,
        'role', mm.role,
        'character_name', mm.character_name,
        'character_notes', case when mm.user_id = auth.uid() or m.owner_id = auth.uid() then mm.character_notes else '' end,
        'rune', mm.rune,
        'color', coalesce(mm.color, p.dice_color),
        'display_name', p.display_name,
        'username', p.username,
        'is_guest', p.is_guest,
        'joined_at', mm.joined_at
      ) order by (mm.role = 'mestre') desc, mm.joined_at)
      from public.mesa_members mm
      join public.profiles p on p.id = mm.user_id
      where mm.mesa_id = p_mesa
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.roll_dice(
  p_mesa uuid,
  p_groups jsonb,
  p_modifier integer default 0,
  p_notation text default '',
  p_label text default null,
  p_private boolean default false
)
returns public.rolls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  mem public.mesa_members;
  prof public.profiles;
  g jsonb;
  die jsonb;
  dtype text;
  sides integer;
  cnt integer;
  total integer := 0;
  vals jsonb;
  out_groups jsonb := '[]'::jsonb;
  row_out public.rolls;
begin
  if uid is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  select * into mem from public.mesa_members where mesa_id = p_mesa and user_id = uid;
  if not found then
    raise exception 'Você não está nesta mesa.' using errcode = '42501';
  end if;
  select * into prof from public.profiles where id = uid;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 or jsonb_array_length(p_groups) > 20 then
    raise exception 'Rolagem inválida.' using errcode = '22023';
  end if;
  if (select count(*) from public.rolls where user_id = uid and created_at > now() - interval '10 seconds') >= 25 then
    raise exception 'Calma! Muitas rolagens em poucos segundos.' using errcode = '54000';
  end if;

  for g in select value from jsonb_array_elements(p_groups) loop
    die := g -> 'die';
    dtype := die ->> 'type';
    sides := (die ->> 'sides')::integer;
    cnt := (g ->> 'count')::integer;
    if dtype not in ('std', 'pct', 'rune', 'faces')
       or sides is null or sides < 2 or sides > 1000
       or cnt is null or cnt < 1 or cnt > 60
       or (dtype = 'pct' and sides <> 100)
       or (dtype = 'rune' and sides <> 24)
       or (dtype = 'faces' and (jsonb_typeof(die -> 'faces') <> 'array' or jsonb_array_length(die -> 'faces') <> sides))
       or coalesce((g ->> 'sign')::integer, 1) not in (1, -1)
       or (g ? 'keep' and jsonb_typeof(g -> 'keep') = 'object' and (
            (g -> 'keep' ->> 'mode') not in ('kh', 'kl', 'dh', 'dl')
            or (g -> 'keep' ->> 'n')::integer < 1
            or (g -> 'keep' ->> 'n')::integer > cnt))
    then
      raise exception 'Rolagem inválida.' using errcode = '22023';
    end if;
    total := total + cnt;
    if total > 60 then
      raise exception 'No máximo 60 dados por rolagem.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(public.rand_int(sides)), '[]'::jsonb) into vals from generate_series(1, cnt);
    out_groups := out_groups || jsonb_build_array(g || jsonb_build_object('values', vals));
  end loop;

  insert into public.rolls (mesa_id, user_id, roller_name, roller_color, roller_rune, label, notation, groups, modifier, seed, is_private)
  values (
    p_mesa,
    uid,
    coalesce(nullif(trim(mem.character_name), ''), prof.display_name),
    coalesce(mem.color, prof.dice_color),
    mem.rune,
    nullif(left(trim(coalesce(p_label, '')), 60), ''),
    left(coalesce(p_notation, ''), 400),
    out_groups,
    greatest(-999, least(999, coalesce(p_modifier, 0))),
    public.rand_int(1073741823),
    coalesce(p_private, false)
  )
  returning * into row_out;

  update public.mesas set last_roll_at = row_out.created_at where id = p_mesa;
  return row_out;
end;
$$;

-- only signed-in users call these; helpers stay private
revoke all on function public.rand_int(integer) from public, anon, authenticated;
revoke all on function public.gen_mesa_code() from public, anon, authenticated;
revoke all on function public.is_mesa_member(uuid) from public, anon;
revoke all on function public.is_mesa_master(uuid) from public, anon;
revoke all on function public.shares_mesa_with(uuid) from public, anon;
grant execute on function public.is_mesa_member(uuid) to authenticated;
grant execute on function public.is_mesa_master(uuid) to authenticated;
grant execute on function public.shares_mesa_with(uuid) to authenticated;

revoke all on function public.ensure_profile() from public, anon;
revoke all on function public.create_mesa(text, text, text, text, boolean) from public, anon;
revoke all on function public.join_mesa(text) from public, anon;
revoke all on function public.regenerate_code(uuid) from public, anon;
revoke all on function public.my_mesas() from public, anon;
revoke all on function public.mesa_state(uuid) from public, anon;
revoke all on function public.roll_dice(uuid, jsonb, integer, text, text, boolean) from public, anon;
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.create_mesa(text, text, text, text, boolean) to authenticated;
grant execute on function public.join_mesa(text) to authenticated;
grant execute on function public.regenerate_code(uuid) to authenticated;
grant execute on function public.my_mesas() to authenticated;
grant execute on function public.mesa_state(uuid) to authenticated;
grant execute on function public.roll_dice(uuid, jsonb, integer, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rolls') then
      alter publication supabase_realtime add table public.rolls;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mesa_members') then
      alter publication supabase_realtime add table public.mesa_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'custom_dice') then
      alter publication supabase_realtime add table public.custom_dice;
    end if;
  end if;
end;
$$;
