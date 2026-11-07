-- Runa 0003: public and private tables in the browser, character sheets,
-- the game master's music, initiative tracker and private notes.
-- Idempotent: safe to run more than once.

-- ================================================================ tables: visibility

alter table public.mesas add column if not exists visibility text not null default 'privada';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mesas_visibility_check' and conrelid = 'public.mesas'::regclass
  ) then
    alter table public.mesas add constraint mesas_visibility_check check (visibility in ('publica', 'privada'));
  end if;
end $$;
grant update (visibility) on table public.mesas to authenticated;

drop function if exists public.create_mesa(text, text, text, text, boolean);
create or replace function public.create_mesa(
  p_name text,
  p_kind text default 'campanha',
  p_system text default 'D&D 5.5',
  p_description text default '',
  p_rune_system boolean default false,
  p_visibility text default 'privada'
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
  insert into public.mesas (code, owner_id, name, kind, system, description, rune_system, visibility)
  values (
    public.gen_mesa_code(),
    uid,
    left(coalesce(nullif(trim(p_name), ''), 'Mesa sem nome'), 80),
    case when p_kind = 'avulsa' then 'avulsa' else 'campanha' end,
    left(coalesce(nullif(trim(p_system), ''), 'D&D 5.5'), 60),
    left(coalesce(p_description, ''), 4000),
    coalesce(p_rune_system, false),
    case when p_visibility = 'publica' then 'publica' else 'privada' end
  )
  returning * into m;
  insert into public.mesa_members (mesa_id, user_id, role, color)
  values (m.id, uid, 'mestre', prof.dice_color);
  return m;
end;
$$;
revoke all on function public.create_mesa(text, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_mesa(text, text, text, text, boolean, text) to authenticated;

-- Every table shows up in the browser. Private ones keep their code and description hidden.
create or replace function public.browse_mesas(
  p_query text default '',
  p_filter text default 'todas',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select '%' || replace(replace(replace(coalesce(trim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  rows as (
    select
      coalesce(m.last_roll_at, m.created_at) as sort_key,
      jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'kind', m.kind,
        'system', m.system,
        'description', case when m.visibility = 'publica' or mm.user_id is not null then m.description else '' end,
        'visibility', m.visibility,
        'rune_system', m.rune_system,
        'created_at', m.created_at,
        'last_roll_at', m.last_roll_at,
        'owner_name', p.display_name,
        'members', (select count(*) from public.mesa_members c where c.mesa_id = m.id),
        'code', case when m.visibility = 'publica' or mm.user_id is not null then m.code end,
        'my_role', mm.role
      ) as x
    from public.mesas m
    join public.profiles p on p.id = m.owner_id
    left join public.mesa_members mm on mm.mesa_id = m.id and mm.user_id = auth.uid()
    cross join q
    where (
        p_filter = 'todas'
        or (p_filter in ('publica', 'privada') and m.visibility = p_filter)
        or (p_filter = 'minhas' and mm.user_id is not null)
      )
      and (
        coalesce(trim(p_query), '') = ''
        or m.name ilike q.pat
        or m.system ilike q.pat
        or p.display_name ilike q.pat
      )
    order by sort_key desc
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(x order by sort_key desc), '[]'::jsonb) from rows;
$$;
revoke all on function public.browse_mesas(text, text, integer, integer) from public;
grant execute on function public.browse_mesas(text, text, integer, integer) to anon, authenticated;

create or replace function public.server_time()
returns timestamptz
language sql
volatile
as $$
  select clock_timestamp();
$$;
revoke all on function public.server_time() from public;
grant execute on function public.server_time() to anon, authenticated;

-- ================================================================ character sheets

create table if not exists public.fichas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null default 'Nova ficha' check (char_length(name) between 1 and 80),
  system text not null default 'dnd5e' check (system in ('dnd5e', 'livre')),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 300),
  attachment_kind text check (attachment_kind is null or attachment_kind in ('pdf', 'image')),
  attachment_name text check (attachment_name is null or char_length(attachment_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fichas_owner_idx on public.fichas (owner_id);

alter table public.mesa_members add column if not exists ficha_id uuid references public.fichas (id) on delete set null;
grant update (ficha_id) on table public.mesa_members to authenticated;

create or replace function public.can_view_ficha(p_ficha uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.fichas f where f.id = p_ficha and f.owner_id = auth.uid())
      or exists (
        select 1
        from public.mesa_members mm
        join public.mesas m on m.id = mm.mesa_id
        where mm.ficha_id = p_ficha and m.owner_id = auth.uid()
      );
$$;
revoke all on function public.can_view_ficha(uuid) from public, anon;
grant execute on function public.can_view_ficha(uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
drop trigger if exists fichas_touch on public.fichas;
create trigger fichas_touch before update on public.fichas for each row execute function public.touch_updated_at();

-- A player can only use their own sheet at a table.
create or replace function public.check_member_ficha()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.ficha_id is not null and (tg_op = 'INSERT' or new.ficha_id is distinct from old.ficha_id) then
    if not exists (select 1 from public.fichas where id = new.ficha_id and owner_id = new.user_id) then
      raise exception 'Essa ficha não é sua.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_member_ficha() from public, anon, authenticated;
drop trigger if exists mesa_members_ficha_check on public.mesa_members;
create trigger mesa_members_ficha_check
  before insert or update of ficha_id on public.mesa_members
  for each row execute function public.check_member_ficha();

alter table public.fichas enable row level security;

drop policy if exists "fichas: dono e mestre veem" on public.fichas;
create policy "fichas: dono e mestre veem" on public.fichas
  for select to authenticated
  using (owner_id = auth.uid() or public.can_view_ficha(id));

drop policy if exists "fichas: dono cria" on public.fichas;
create policy "fichas: dono cria" on public.fichas
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "fichas: dono edita" on public.fichas;
create policy "fichas: dono edita" on public.fichas
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "fichas: dono apaga" on public.fichas;
create policy "fichas: dono apaga" on public.fichas
  for delete to authenticated
  using (owner_id = auth.uid());

-- Uploaded sheets (PDF or image) live in a private Storage bucket, one folder per user.
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'runa: sem Storage neste banco; anexos de ficha desligados';
    return;
  end if;
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fichas', 'fichas', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "runa fichas: dono envia" on storage.objects;
    create policy "runa fichas: dono envia" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'fichas' and (storage.foldername(name))[1] = auth.uid()::text);

    drop policy if exists "runa fichas: dono troca" on storage.objects;
    create policy "runa fichas: dono troca" on storage.objects
      for update to authenticated
      using (bucket_id = 'fichas' and (storage.foldername(name))[1] = auth.uid()::text);

    drop policy if exists "runa fichas: dono apaga" on storage.objects;
    create policy "runa fichas: dono apaga" on storage.objects
      for delete to authenticated
      using (bucket_id = 'fichas' and (storage.foldername(name))[1] = auth.uid()::text);

    drop policy if exists "runa fichas: quem ve a ficha baixa" on storage.objects;
    create policy "runa fichas: quem ve a ficha baixa" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'fichas'
        and (
          (storage.foldername(objects.name))[1] = auth.uid()::text
          or exists (
            select 1 from public.fichas f
            where f.attachment_path = objects.name and public.can_view_ficha(f.id)
          )
        )
      );
    raise notice 'runa: armazenamento de fichas pronto';
  exception when others then
    raise notice 'runa: não deu para preparar o Storage das fichas: %', sqlerrm;
  end;
end $$;

-- ================================================================ music

create table if not exists public.musicas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 120),
  url text not null check (char_length(url) between 8 and 1000 and url ~* '^https?://'),
  tipo text not null check (tipo in ('youtube', 'audio')),
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  created_at timestamptz not null default now()
);
create index if not exists musicas_owner_idx on public.musicas (owner_id);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60),
  posicao integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists playlists_owner_idx on public.playlists (owner_id);

create table if not exists public.playlist_musicas (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  musica_id uuid not null references public.musicas (id) on delete cascade,
  posicao integer not null default 0,
  primary key (playlist_id, musica_id)
);
create index if not exists playlist_musicas_musica_idx on public.playlist_musicas (musica_id);

alter table public.musicas enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_musicas enable row level security;

drop policy if exists "musicas: so o dono" on public.musicas;
create policy "musicas: so o dono" on public.musicas
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "playlists: so o dono" on public.playlists;
create policy "playlists: so o dono" on public.playlists
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "playlist_musicas: so o dono" on public.playlist_musicas;
create policy "playlist_musicas: so o dono" on public.playlist_musicas
  for all to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid()))
  with check (
    exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid())
    and exists (select 1 from public.musicas mu where mu.id = musica_id and mu.owner_id = auth.uid())
  );

create or replace function public.playlist_reordenar(p_playlist uuid, p_musicas uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.playlists where id = p_playlist and owner_id = auth.uid()) then
    raise exception 'Playlist não encontrada.' using errcode = '42501';
  end if;
  update public.playlist_musicas pm
  set posicao = o.ord
  from unnest(p_musicas) with ordinality as o(musica_id, ord)
  where pm.playlist_id = p_playlist and pm.musica_id = o.musica_id;
end;
$$;
revoke all on function public.playlist_reordenar(uuid, uuid[]) from public, anon;
grant execute on function public.playlist_reordenar(uuid, uuid[]) to authenticated;

-- What is playing at a table. Two channels: music (a queue) and ambience (usually one looping track).
-- Clients compute the current position as posicao + (now - iniciado_em) while tocando.
create table if not exists public.mesa_som (
  mesa_id uuid not null references public.mesas (id) on delete cascade,
  canal text not null check (canal in ('musica', 'ambiente')),
  faixa jsonb,
  fila jsonb not null default '[]'::jsonb,
  fila_idx integer not null default 0,
  tocando boolean not null default false,
  posicao double precision not null default 0,
  iniciado_em timestamptz not null default now(),
  repetir boolean not null default false,
  volume double precision not null default 1 check (volume between 0 and 1),
  -- goes up by one on every change, so clients can drop late or repeated updates
  versao bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (mesa_id, canal)
);
alter table public.mesa_som enable row level security;
drop policy if exists "som: membros ouvem" on public.mesa_som;
create policy "som: membros ouvem" on public.mesa_som
  for select to authenticated
  using (public.is_mesa_member(mesa_id));

create or replace function public.som_faixa_valida(f jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(f) = 'object'
     and jsonb_typeof(f -> 'url') = 'string'
     and (f ->> 'url') ~* '^https?://'
     and char_length(f ->> 'url') <= 1000
     and (f ->> 'tipo') in ('youtube', 'audio')
     and char_length(coalesce(f ->> 'titulo', '')) between 1 and 120
     and ((f ->> 'tipo') = 'audio' or coalesce(f ->> 'youtube_id', '') ~ '^[A-Za-z0-9_-]{6,20}$');
$$;
revoke all on function public.som_faixa_valida(jsonb) from public, anon;

create or replace function public.som_controlar(
  p_mesa uuid,
  p_canal text,
  p_acao text,
  p_dados jsonb default '{}'::jsonb
)
returns public.mesa_som
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.mesa_som;
  agora timestamptz := clock_timestamp();
  pos double precision;
  n integer;
  f jsonb;
begin
  if not public.is_mesa_master(p_mesa) then
    raise exception 'Só o mestre controla a música.' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('musica', 'ambiente') then
    raise exception 'Canal inválido.' using errcode = '22023';
  end if;
  p_dados := coalesce(p_dados, '{}'::jsonb);

  -- The row is written once, at the end, so listeners never see a half-made state.
  select * into s from public.mesa_som where mesa_id = p_mesa and canal = p_canal for update;
  if not found then
    s.mesa_id := p_mesa;
    s.canal := p_canal;
    s.faixa := null;
    s.fila := '[]'::jsonb;
    s.fila_idx := 0;
    s.tocando := false;
    s.posicao := 0;
    s.iniciado_em := agora;
    s.repetir := p_canal = 'ambiente';
    s.volume := 1;
    s.versao := 0;
  end if;

  pos := case when s.tocando then s.posicao + extract(epoch from (agora - s.iniciado_em)) else s.posicao end;

  if p_acao = 'tocar' then
    if jsonb_typeof(p_dados -> 'fila') = 'array' and jsonb_array_length(p_dados -> 'fila') > 0 then
      s.fila := p_dados -> 'fila';
    elsif jsonb_typeof(p_dados -> 'faixa') = 'object' then
      s.fila := jsonb_build_array(p_dados -> 'faixa');
    else
      raise exception 'Escolha uma música para tocar.' using errcode = '22023';
    end if;
    if jsonb_array_length(s.fila) > 300 then
      raise exception 'A fila pode ter no máximo 300 músicas.' using errcode = '22023';
    end if;
    for f in select value from jsonb_array_elements(s.fila) loop
      if not public.som_faixa_valida(f) then
        raise exception 'Música inválida na fila.' using errcode = '22023';
      end if;
    end loop;
    s.fila_idx := greatest(0, least(coalesce((p_dados ->> 'idx')::integer, 0), jsonb_array_length(s.fila) - 1));
    s.faixa := s.fila -> s.fila_idx;
    s.tocando := true;
    s.posicao := greatest(0, coalesce((p_dados ->> 'posicao')::double precision, 0));
    s.iniciado_em := agora;
    if p_dados ? 'repetir' then
      s.repetir := coalesce((p_dados ->> 'repetir')::boolean, s.repetir);
    end if;
  elsif p_acao = 'pausar' then
    s.posicao := pos;
    s.tocando := false;
    s.iniciado_em := agora;
  elsif p_acao = 'continuar' then
    if s.faixa is null then
      raise exception 'Nada para tocar.' using errcode = '22023';
    end if;
    s.posicao := pos;
    s.tocando := true;
    s.iniciado_em := agora;
  elsif p_acao = 'buscar' then
    s.posicao := greatest(0, coalesce((p_dados ->> 'posicao')::double precision, 0));
    s.iniciado_em := agora;
  elsif p_acao in ('proxima', 'anterior') then
    n := jsonb_array_length(s.fila);
    if n = 0 or s.faixa is null then
      raise exception 'A fila está vazia.' using errcode = '22023';
    end if;
    if p_acao = 'anterior' and pos > 4 then
      s.posicao := 0;
    elsif p_acao = 'proxima' and coalesce((p_dados ->> 'fim')::boolean, false)
          and s.fila_idx >= n - 1 and not s.repetir then
      -- the last track ended and the queue does not repeat: stop at the start of the queue
      s.fila_idx := 0;
      s.faixa := s.fila -> 0;
      s.tocando := false;
      s.posicao := 0;
    else
      s.fila_idx := (s.fila_idx + case when p_acao = 'proxima' then 1 else -1 end + n) % n;
      s.faixa := s.fila -> s.fila_idx;
      s.posicao := 0;
      s.tocando := true;
    end if;
    s.iniciado_em := agora;
  elsif p_acao = 'parar' then
    s.tocando := false;
    s.posicao := 0;
    s.faixa := null;
    s.fila := '[]'::jsonb;
    s.fila_idx := 0;
    s.iniciado_em := agora;
  elsif p_acao = 'repetir' then
    s.repetir := coalesce((p_dados ->> 'valor')::boolean, not s.repetir);
    s.posicao := pos;
    s.iniciado_em := agora;
  elsif p_acao = 'volume' then
    s.volume := greatest(0, least(1, coalesce((p_dados ->> 'valor')::double precision, 1)));
    s.posicao := pos;
    s.iniciado_em := agora;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  insert into public.mesa_som as m (mesa_id, canal, faixa, fila, fila_idx, tocando, posicao, iniciado_em, repetir, volume, versao, atualizado_em)
  values (p_mesa, p_canal, s.faixa, s.fila, s.fila_idx, s.tocando, s.posicao, s.iniciado_em, s.repetir, s.volume, s.versao + 1, agora)
  on conflict (mesa_id, canal) do update
  set faixa = excluded.faixa,
      fila = excluded.fila,
      fila_idx = excluded.fila_idx,
      tocando = excluded.tocando,
      posicao = excluded.posicao,
      iniciado_em = excluded.iniciado_em,
      repetir = excluded.repetir,
      volume = excluded.volume,
      versao = m.versao + 1,
      atualizado_em = excluded.atualizado_em
  returning * into s;
  return s;
end;
$$;
revoke all on function public.som_controlar(uuid, text, text, jsonb) from public, anon;
grant execute on function public.som_controlar(uuid, text, text, jsonb) to authenticated;

-- ================================================================ initiative

create table if not exists public.mesa_combate (
  mesa_id uuid primary key references public.mesas (id) on delete cascade,
  ativo boolean not null default false,
  rodada integer not null default 1,
  turno uuid,
  versao bigint not null default 0,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.combatentes (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 60),
  iniciativa integer not null default 0 check (iniciativa between -50 and 100),
  desempate integer not null default 0 check (desempate between -20 and 20),
  pv integer check (pv is null or pv between -9999 and 99999),
  pv_max integer check (pv_max is null or pv_max between 0 and 99999),
  ca integer check (ca is null or ca between 0 and 99),
  cor text check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$'),
  oculto boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists combatentes_mesa_idx on public.combatentes (mesa_id);

alter table public.mesa_combate enable row level security;
alter table public.combatentes enable row level security;

drop policy if exists "combate: membros veem" on public.mesa_combate;
create policy "combate: membros veem" on public.mesa_combate
  for select to authenticated
  using (public.is_mesa_member(mesa_id));

-- Players read the order through iniciativa_estado(), which hides the hit points of hidden creatures.
drop policy if exists "combatentes: mestre controla" on public.combatentes;
create policy "combatentes: mestre controla" on public.combatentes
  for all to authenticated
  using (public.is_mesa_master(mesa_id))
  with check (public.is_mesa_master(mesa_id));

create or replace function public.combatentes_mudou()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m uuid;
begin
  if tg_op = 'DELETE' then
    m := old.mesa_id;
  else
    m := new.mesa_id;
  end if;
  -- the table itself is being deleted (cascade): nothing to bump
  if not exists (select 1 from public.mesas where id = m) then
    return null;
  end if;
  insert into public.mesa_combate (mesa_id, versao)
  values (m, 1)
  on conflict (mesa_id) do update
    set versao = public.mesa_combate.versao + 1, atualizado_em = now();
  return null;
end;
$$;
revoke all on function public.combatentes_mudou() from public, anon, authenticated;
drop trigger if exists combatentes_versao on public.combatentes;
create trigger combatentes_versao
  after insert or update or delete on public.combatentes
  for each row execute function public.combatentes_mudou();

create or replace function public.iniciativa_estado(p_mesa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  is_master boolean;
  c public.mesa_combate;
begin
  if not public.is_mesa_member(p_mesa) then
    raise exception 'Você não está nesta mesa.' using errcode = '42501';
  end if;
  is_master := public.is_mesa_master(p_mesa);
  select * into c from public.mesa_combate where mesa_id = p_mesa;
  return jsonb_build_object(
    'ativo', coalesce(c.ativo, false),
    'rodada', coalesce(c.rodada, 1),
    'turno', c.turno,
    'versao', coalesce(c.versao, 0),
    'combatentes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'user_id', x.user_id,
          'nome', x.nome,
          'iniciativa', x.iniciativa,
          'desempate', x.desempate,
          'cor', x.cor,
          'oculto', x.oculto,
          'pv', case when is_master or not x.oculto or x.user_id = auth.uid() then x.pv end,
          'pv_max', case when is_master or not x.oculto or x.user_id = auth.uid() then x.pv_max end,
          'ca', case when is_master or not x.oculto or x.user_id = auth.uid() then x.ca end,
          'estado', case
            when x.pv_max is null or x.pv_max <= 0 or x.pv is null then null
            when x.pv <= 0 then 'caido'
            when x.pv * 2 <= x.pv_max then 'muito ferido'
            when x.pv < x.pv_max then 'ferido'
            else 'ileso'
          end
        )
        order by x.iniciativa desc, x.desempate desc, x.criado_em asc
      )
      from public.combatentes x
      where x.mesa_id = p_mesa
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.iniciativa_estado(uuid) from public, anon;
grant execute on function public.iniciativa_estado(uuid) to authenticated;

create or replace function public.iniciativa_entrar(p_mesa uuid, p_valor integer, p_desempate integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mem public.mesa_members;
  prof public.profiles;
  cid uuid;
  nome_ text;
begin
  select * into mem from public.mesa_members where mesa_id = p_mesa and user_id = auth.uid();
  if not found then
    raise exception 'Você não está nesta mesa.' using errcode = '42501';
  end if;
  select * into prof from public.profiles where id = auth.uid();
  nome_ := left(coalesce(nullif(trim(mem.character_name), ''), prof.display_name), 60);
  select id into cid from public.combatentes where mesa_id = p_mesa and user_id = auth.uid();
  if cid is null then
    if (select count(*) from public.combatentes where mesa_id = p_mesa) >= 100 then
      raise exception 'A iniciativa já tem 100 combatentes.' using errcode = '54000';
    end if;
    insert into public.combatentes (mesa_id, user_id, nome, iniciativa, desempate, cor)
    values (
      p_mesa, auth.uid(), nome_,
      greatest(-50, least(100, coalesce(p_valor, 0))),
      greatest(-20, least(20, coalesce(p_desempate, 0))),
      coalesce(mem.color, prof.dice_color)
    );
  else
    update public.combatentes
    set iniciativa = greatest(-50, least(100, coalesce(p_valor, 0))),
        desempate = greatest(-20, least(20, coalesce(p_desempate, 0))),
        nome = nome_,
        cor = coalesce(mem.color, prof.dice_color)
    where id = cid;
  end if;
  return public.iniciativa_estado(p_mesa);
end;
$$;
revoke all on function public.iniciativa_entrar(uuid, integer, integer) from public, anon;
grant execute on function public.iniciativa_entrar(uuid, integer, integer) to authenticated;

create or replace function public.combate_controlar(p_mesa uuid, p_acao text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.mesa_combate;
  total integer;
  atual integer;
  novo integer;
  nova_rodada integer;
  prox uuid;
begin
  if not public.is_mesa_master(p_mesa) then
    raise exception 'Só o mestre controla a iniciativa.' using errcode = '42501';
  end if;
  insert into public.mesa_combate (mesa_id) values (p_mesa) on conflict (mesa_id) do nothing;
  select * into c from public.mesa_combate where mesa_id = p_mesa for update;
  select count(*) into total from public.combatentes where mesa_id = p_mesa;

  if p_acao = 'iniciar' then
    if total = 0 then
      raise exception 'Adicione combatentes antes de começar.' using errcode = '22023';
    end if;
    select id into prox from public.combatentes where mesa_id = p_mesa
    order by iniciativa desc, desempate desc, criado_em asc limit 1;
    update public.mesa_combate set ativo = true, rodada = 1, turno = prox, versao = versao + 1, atualizado_em = now()
    where mesa_id = p_mesa;
  elsif p_acao = 'encerrar' then
    update public.mesa_combate set ativo = false, rodada = 1, turno = null, versao = versao + 1, atualizado_em = now()
    where mesa_id = p_mesa;
  elsif p_acao = 'limpar' then
    delete from public.combatentes where mesa_id = p_mesa;
    update public.mesa_combate set ativo = false, rodada = 1, turno = null, versao = versao + 1, atualizado_em = now()
    where mesa_id = p_mesa;
  elsif p_acao in ('proximo', 'anterior') then
    if total = 0 then
      raise exception 'Não há combatentes.' using errcode = '22023';
    end if;
    select o.rn into atual from (
      select id, row_number() over (order by iniciativa desc, desempate desc, criado_em asc) as rn
      from public.combatentes where mesa_id = p_mesa
    ) o where o.id = c.turno;
    nova_rodada := c.rodada;
    if atual is null then
      novo := case when p_acao = 'proximo' then 1 else total end;
    elsif p_acao = 'proximo' then
      novo := atual + 1;
      if novo > total then
        novo := 1;
        nova_rodada := c.rodada + 1;
      end if;
    else
      novo := atual - 1;
      if novo < 1 then
        novo := total;
        nova_rodada := greatest(1, c.rodada - 1);
      end if;
    end if;
    select o.id into prox from (
      select id, row_number() over (order by iniciativa desc, desempate desc, criado_em asc) as rn
      from public.combatentes where mesa_id = p_mesa
    ) o where o.rn = novo;
    update public.mesa_combate set ativo = true, rodada = nova_rodada, turno = prox, versao = versao + 1, atualizado_em = now()
    where mesa_id = p_mesa;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  return public.iniciativa_estado(p_mesa);
end;
$$;
revoke all on function public.combate_controlar(uuid, text) from public, anon;
grant execute on function public.combate_controlar(uuid, text) to authenticated;

-- ================================================================ game master notes

create table if not exists public.mesa_notas (
  mesa_id uuid primary key references public.mesas (id) on delete cascade,
  texto text not null default '' check (char_length(texto) <= 20000),
  atualizado_em timestamptz not null default now()
);
alter table public.mesa_notas enable row level security;
drop policy if exists "notas: so o mestre" on public.mesa_notas;
create policy "notas: so o mestre" on public.mesa_notas
  for select to authenticated
  using (public.is_mesa_master(mesa_id));

create or replace function public.notas_salvar(p_mesa uuid, p_texto text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  agora timestamptz := now();
begin
  if not public.is_mesa_master(p_mesa) then
    raise exception 'Só o mestre escreve nas notas da mesa.' using errcode = '42501';
  end if;
  insert into public.mesa_notas (mesa_id, texto, atualizado_em)
  values (p_mesa, left(coalesce(p_texto, ''), 20000), agora)
  on conflict (mesa_id) do update set texto = excluded.texto, atualizado_em = excluded.atualizado_em;
  return agora;
end;
$$;
revoke all on function public.notas_salvar(uuid, text) from public, anon;
grant execute on function public.notas_salvar(uuid, text) to authenticated;

-- ================================================================ updated helpers

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
        'visibility', m.visibility,
        'created_at', m.created_at,
        'last_roll_at', m.last_roll_at,
        'owner_id', m.owner_id,
        'owner_name', p.display_name,
        'role', mm.role,
        'character_name', mm.character_name,
        'character_notes', mm.character_notes,
        'rune', mm.rune,
        'color', mm.color,
        'ficha_id', mm.ficha_id,
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
        'joined_at', mm.joined_at,
        'ficha_id', case when mm.user_id = auth.uid() or m.owner_id = auth.uid() then mm.ficha_id end
      ) order by (mm.role = 'mestre') desc, mm.joined_at)
      from public.mesa_members mm
      join public.profiles p on p.id = mm.user_id
      where mm.mesa_id = p_mesa
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ================================================================ privileges

revoke all on table public.fichas, public.musicas, public.playlists, public.playlist_musicas,
  public.mesa_som, public.mesa_combate, public.combatentes, public.mesa_notas from anon, authenticated;

grant select, delete on table public.fichas to authenticated;
grant insert (name, system, data, attachment_path, attachment_kind, attachment_name) on table public.fichas to authenticated;
grant update (name, system, data, attachment_path, attachment_kind, attachment_name) on table public.fichas to authenticated;

grant select, delete on table public.musicas to authenticated;
grant insert (titulo, url, tipo, youtube_id) on table public.musicas to authenticated;
grant update (titulo) on table public.musicas to authenticated;

grant select, delete on table public.playlists to authenticated;
grant insert (nome, posicao) on table public.playlists to authenticated;
grant update (nome, posicao) on table public.playlists to authenticated;

grant select, delete on table public.playlist_musicas to authenticated;
grant insert (playlist_id, musica_id, posicao) on table public.playlist_musicas to authenticated;
grant update (posicao) on table public.playlist_musicas to authenticated;

grant select on table public.mesa_som to authenticated;
grant select on table public.mesa_combate to authenticated;

grant select, delete on table public.combatentes to authenticated;
grant insert (mesa_id, user_id, nome, iniciativa, desempate, pv, pv_max, ca, cor, oculto) on table public.combatentes to authenticated;
grant update (nome, iniciativa, desempate, pv, pv_max, ca, cor, oculto) on table public.combatentes to authenticated;

grant select on table public.mesa_notas to authenticated;

grant all on table public.fichas, public.musicas, public.playlists, public.playlist_musicas,
  public.mesa_som, public.mesa_combate, public.combatentes, public.mesa_notas to service_role;

-- ================================================================ realtime

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['mesa_som', 'mesa_combate', 'fichas'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
