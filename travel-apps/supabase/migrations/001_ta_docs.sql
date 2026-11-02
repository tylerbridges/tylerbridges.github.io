-- Packing-list documents for the free Supabase project.
-- Safe to re-run in the SQL editor after the table already exists.
-- Dashboard: https://supabase.com/dashboard/project/bpimarlvrastqchhxdcl/sql/new
--
-- One row per db.doc path (trips/KAUAI, trip/KAUAI/pack_items/abc, meta/packing, …).
-- The browser lists a collection by loading the signed-in user's rows and keeping
-- immediate children, the same rule as the old localStorage keys. Underscores in
-- trip ids are literal, so this does not use LIKE.
--
-- Do not add the service_role or secret key to the website. The publishable key
-- is enough because these policies only allow auth.uid() = user_id.

create table if not exists public.ta_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, path)
);

create index if not exists ta_docs_user_path_prefix on public.ta_docs (user_id, path);

alter table public.ta_docs enable row level security;

-- DELETE events need the path, not only the uuid primary key, for live updates.
alter table public.ta_docs replica identity full;

drop policy if exists "ta_docs_select_own" on public.ta_docs;
drop policy if exists "ta_docs_insert_own" on public.ta_docs;
drop policy if exists "ta_docs_update_own" on public.ta_docs;
drop policy if exists "ta_docs_delete_own" on public.ta_docs;

create policy "ta_docs_select_own" on public.ta_docs
  for select using (auth.uid() = user_id);
create policy "ta_docs_insert_own" on public.ta_docs
  for insert with check (auth.uid() = user_id);
create policy "ta_docs_update_own" on public.ta_docs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ta_docs_delete_own" on public.ta_docs
  for delete using (auth.uid() = user_id);

revoke all on table public.ta_docs from public, anon;
grant select, insert, update, delete on table public.ta_docs to authenticated;

create or replace function public.ta_docs_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- The signed-in user can only write their own rows, even if the request names another id.
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists ta_docs_touch on public.ta_docs;
create trigger ta_docs_touch
  before insert or update on public.ta_docs
  for each row execute function public.ta_docs_touch();

grant execute on function public.ta_docs_touch() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.ta_docs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;
