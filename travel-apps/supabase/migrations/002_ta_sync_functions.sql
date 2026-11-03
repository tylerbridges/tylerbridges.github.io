-- Sync functions for the Travel Dashboard (a Claude artifact).
-- The Dashboard reaches this project through the claude.ai Supabase connector (execute_sql, run as the
-- project owner), not through the publishable key, so it calls these functions instead of sending raw SQL.
-- Execute is revoked from public/anon/authenticated: the website's publishable key cannot call them.
-- All three take the account's user id explicitly (the project has a single account).

-- Every row's path and last-change time, for the change comparison.
create or replace function public.ta_sync_state(uid uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(path, to_jsonb(updated_at)), '{}'::jsonb)
  from public.ta_docs where user_id = uid;
$$;

-- Documents for the given paths: {path: {data, at}}.
create or replace function public.ta_sync_read(uid uuid, paths jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(path, jsonb_build_object('data', data, 'at', updated_at)), '{}'::jsonb)
  from public.ta_docs
  where user_id = uid and path in (select jsonb_array_elements_text(paths));
$$;

-- Upsert docs ({path: data}) and remove paths (["path", …]); returns {path: updated_at} for the written rows.
create or replace function public.ta_sync_write(uid uuid, docs jsonb, removed jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare out jsonb;
begin
  if docs is not null and docs <> '{}'::jsonb then
    insert into public.ta_docs (user_id, path, data)
    select uid, key, value from jsonb_each(docs)
    on conflict (user_id, path) do update set data = excluded.data;
  end if;
  if removed is not null and jsonb_array_length(removed) > 0 then
    delete from public.ta_docs where user_id = uid and path in (select jsonb_array_elements_text(removed));
  end if;
  select coalesce(jsonb_object_agg(path, to_jsonb(updated_at)), '{}'::jsonb) into out
  from public.ta_docs where user_id = uid and path in (select jsonb_object_keys(coalesce(docs, '{}'::jsonb)));
  return out;
end;
$$;

revoke all on function public.ta_sync_state(uuid) from public, anon, authenticated;
revoke all on function public.ta_sync_read(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ta_sync_write(uuid, jsonb, jsonb) from public, anon, authenticated;
