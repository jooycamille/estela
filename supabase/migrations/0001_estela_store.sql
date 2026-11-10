-- Estela's data in Postgres. Each record is kept whole, as JSON, keyed by its id, in a table for its kind; a few fields
-- are copied out into columns so they can be indexed (a trip's bookings, a person's devices).
--
-- Only Estela's server reads and writes these tables, with the project's secret key. Row-level security is on with no
-- policies, and the browser roles have no grants: the publishable key can't read or change anything here.

create table if not exists public.trips (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id text primary key,
  data jsonb not null,
  trip_id text generated always as (data->>'tripId') stored,
  updated_at timestamptz not null default now()
);
create index if not exists items_trip_id on public.items (trip_id);

create table if not exists public.lists (
  id text primary key,
  data jsonb not null,
  trip_id text generated always as (data->>'tripId') stored,
  updated_at timestamptz not null default now()
);
create index if not exists lists_trip_id on public.lists (trip_id);

create table if not exists public.inboxes (
  id text primary key, -- the trip's id: one inbox per trip
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key,
  data jsonb not null,
  email text generated always as (lower(data->>'email')) stored,
  updated_at timestamptz not null default now()
);
create index if not exists users_email on public.users (email);

create table if not exists public.sessions (
  id text primary key,
  data jsonb not null,
  user_id text generated always as (data->>'userId') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subs (
  id text primary key, -- the subscription's endpoint
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders_sent (
  id text primary key, -- "tripId|itemId|at"
  data jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['trips', 'items', 'lists', 'inboxes', 'attachments', 'users', 'sessions', 'invites', 'push_subs', 'reminders_sent'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
