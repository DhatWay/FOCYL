-- ============================================================
-- FOCYL — SCHEMA v2  (safe to run on an existing database)
--
-- v1 assumed empty tables. Yours already existed from the
-- dashboard, so `create table if not exists` skipped them and the
-- new columns were never added — hence "is_template does not exist".
--
-- v2 creates what is missing, then ALTERs every table into shape
-- column by column. Re-runnable as many times as you like.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. TABLES (created only if absent)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.tiles (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.sparks_ledger (
  id bigserial primary key
);

-- ============================================================
-- 2. COLUMNS (added only if absent)
-- ============================================================

-- ---------- profiles ----------
alter table public.profiles add column if not exists email          text;
alter table public.profiles add column if not exists display_name   text;
alter table public.profiles add column if not exists avatar_url     text;
alter table public.profiles add column if not exists tier           text not null default 'spark';
alter table public.profiles add column if not exists sparks_balance integer not null default 100;
alter table public.profiles add column if not exists created_at     timestamptz not null default now();

-- ---------- boards ----------
alter table public.boards add column if not exists user_id     uuid;
alter table public.boards add column if not exists title       text not null default 'My Board';
alter table public.boards add column if not exists width       integer not null default 1600;
alter table public.boards add column if not exists height      integer not null default 1600;
alter table public.boards add column if not exists canvas_id   text;
alter table public.boards add column if not exists border_id   text;
alter table public.boards add column if not exists template_id text;
alter table public.boards add column if not exists is_template boolean not null default false;
alter table public.boards add column if not exists updated_at  timestamptz not null default now();
alter table public.boards add column if not exists created_at  timestamptz not null default now();

-- ---------- tiles ----------
alter table public.tiles add column if not exists board_id   uuid;
alter table public.tiles add column if not exists type       text;
alter table public.tiles add column if not exists source     text default 'library';
alter table public.tiles add column if not exists content    jsonb not null default '{}'::jsonb;
alter table public.tiles add column if not exists x          real not null default 0;
alter table public.tiles add column if not exists y          real not null default 0;
alter table public.tiles add column if not exists w          real not null default 160;
alter table public.tiles add column if not exists h          real not null default 160;
alter table public.tiles add column if not exists z          integer not null default 1;
alter table public.tiles add column if not exists rotation   real not null default 0;
alter table public.tiles add column if not exists outline    boolean not null default false;
alter table public.tiles add column if not exists library_id text;
alter table public.tiles add column if not exists asset_id   text;
alter table public.tiles add column if not exists updated_at timestamptz not null default now();

-- ---------- goals ----------
alter table public.goals add column if not exists user_id       uuid;
alter table public.goals add column if not exists board_id      uuid;
alter table public.goals add column if not exists tile_id       uuid;
alter table public.goals add column if not exists statement     text;
alter table public.goals add column if not exists cue           text;
alter table public.goals add column if not exists action        text;
alter table public.goals add column if not exists obstacle      text;
alter table public.goals add column if not exists plan          text;
alter table public.goals add column if not exists target_date   date;
alter table public.goals add column if not exists metric_kind   text;
alter table public.goals add column if not exists target_value  numeric;
alter table public.goals add column if not exists current_value numeric default 0;
alter table public.goals add column if not exists status        text not null default 'active';
alter table public.goals add column if not exists created_at    timestamptz not null default now();

-- ---------- checkins ----------
alter table public.checkins add column if not exists goal_id    uuid;
alter table public.checkins add column if not exists user_id    uuid;
alter table public.checkins add column if not exists value      numeric;
alter table public.checkins add column if not exists note       text;
alter table public.checkins add column if not exists created_at timestamptz not null default now();

-- ---------- sparks_ledger ----------
alter table public.sparks_ledger add column if not exists user_id    uuid;
alter table public.sparks_ledger add column if not exists delta      integer;
alter table public.sparks_ledger add column if not exists reason     text;
alter table public.sparks_ledger add column if not exists ref        text;
alter table public.sparks_ledger add column if not exists created_at timestamptz not null default now();

-- ============================================================
-- 3. CONSTRAINTS
--    Dropped and recreated so a narrower existing check (e.g. one
--    that rejects 'ribbon') is widened rather than left in place.
-- ============================================================
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles add  constraint profiles_tier_check
  check (tier in ('spark','press','film'));

alter table public.profiles drop constraint if exists profiles_sparks_check;
alter table public.profiles add  constraint profiles_sparks_check
  check (sparks_balance >= 0);

alter table public.tiles drop constraint if exists tiles_type_check;
alter table public.tiles add  constraint tiles_type_check
  check (type in ('image','text','audio','note','ribbon','data','video'));

alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add  constraint goals_status_check
  check (status in ('active','paused','achieved','abandoned'));

alter table public.goals drop constraint if exists goals_metric_check;
alter table public.goals add  constraint goals_metric_check
  check (metric_kind is null or metric_kind in ('binary','count','currency','duration'));

-- ============================================================
-- 4. FOREIGN KEYS (added only if absent)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boards_user_id_fkey') then
    alter table public.boards
      add constraint boards_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tiles_board_id_fkey') then
    alter table public.tiles
      add constraint tiles_board_id_fkey
      foreign key (board_id) references public.boards(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'goals_user_id_fkey') then
    alter table public.goals
      add constraint goals_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'checkins_goal_id_fkey') then
    alter table public.checkins
      add constraint checkins_goal_id_fkey
      foreign key (goal_id) references public.goals(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sparks_user_id_fkey') then
    alter table public.sparks_ledger
      add constraint sparks_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ============================================================
-- 5. INDEXES
-- ============================================================
create index if not exists boards_user_idx   on public.boards(user_id);
create index if not exists tiles_board_idx   on public.tiles(board_id);
create index if not exists goals_user_idx    on public.goals(user_id);
create index if not exists checkins_goal_idx on public.checkins(goal_id, created_at desc);
create index if not exists sparks_user_idx   on public.sparks_ledger(user_id, created_at desc);

-- ============================================================
-- 6. AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before the trigger existed.
insert into public.profiles (id, email, display_name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.boards        enable row level security;
alter table public.tiles         enable row level security;
alter table public.goals         enable row level security;
alter table public.checkins      enable row level security;
alter table public.sparks_ledger enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own boards" on public.boards;
create policy "own boards" on public.boards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public templates readable" on public.boards;
create policy "public templates readable" on public.boards
  for select using (is_template = true);

drop policy if exists "own tiles" on public.tiles;
create policy "own tiles" on public.tiles
  for all using (
    exists (select 1 from public.boards b
            where b.id = tiles.board_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.boards b
            where b.id = tiles.board_id and b.user_id = auth.uid())
  );

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own checkins" on public.checkins;
create policy "own checkins" on public.checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own ledger" on public.sparks_ledger;
create policy "read own ledger" on public.sparks_ledger
  for select using (auth.uid() = user_id);

-- ============================================================
-- 8. STORAGE
-- ============================================================
insert into storage.buckets (id, name, public)
values ('board-media', 'board-media', true)
on conflict (id) do nothing;

drop policy if exists "own media upload" on storage.objects;
create policy "own media upload" on storage.objects
  for insert with check (
    bucket_id = 'board-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own media manage" on storage.objects;
create policy "own media manage" on storage.objects
  for all using (
    bucket_id = 'board-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media readable" on storage.objects;
create policy "media readable" on storage.objects
  for select using (bucket_id = 'board-media');

-- ============================================================
-- 9. VERIFY — returns zero rows when everything applied cleanly
-- ============================================================
select 'MISSING: ' || t || '.' || c as problem
from (values
  ('boards','is_template'), ('boards','user_id'), ('boards','updated_at'),
  ('tiles','library_id'),   ('tiles','asset_id'), ('tiles','updated_at'),
  ('goals','cue'),          ('goals','plan'),
  ('profiles','tier'),      ('profiles','sparks_balance')
) as x(t,c)
where not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name=x.t and column_name=x.c
);
