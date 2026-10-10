-- Task 3: stop devices re-creating rows that were hard-deleted on the server.
--
-- Sync sends "insert or update" (upsert), so a device still holding a deleted
-- order would insert it again. Every hard delete now leaves a record in
-- private.deleted_records, and inserting a recorded id is silently skipped.
-- Skipped, not rejected: a rejection would set the row aside on the device as
-- "not backed up" instead of quietly dropping data that was deleted on purpose.
--
-- Down (manual, in this order):
--   drop trigger orders_after_delete on public.orders;
--   re-run the orders_before_write definition from 20261010000000_create_orders.sql;
--   drop schema private cascade;

-- ---------------------------------------------------------------------------
-- Private schema: not exposed through Supabase's Data API (only "public" is).
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

create table private.deleted_records (
  table_name text        not null,
  record_id  uuid        not null,
  -- Who owned the row. No foreign key: the vendor may itself have been deleted.
  vendor_id  uuid,
  deleted_at timestamptz not null default now(),
  primary key (table_name, record_id)
);

-- Defence in depth: no policies, no client grants. Only the functions below,
-- which run as the owner, read or write it.
alter table private.deleted_records enable row level security;
revoke all on private.deleted_records from public, anon, authenticated;

-- Answers only "was this id deleted?" so the write trigger can check it as the
-- signed-in user, without giving them access to the list itself.
create function private.is_deleted_record(p_table text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.deleted_records where table_name = p_table and record_id = p_id
  );
$$;

-- Records every hard delete, whoever performs it (dashboard, SQL, or the
-- cascade when an account is deleted).
create function private.record_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.deleted_records (table_name, record_id, vendor_id)
  values (tg_table_name, old.id, old.vendor_id)
  on conflict (table_name, record_id) do nothing;
  return old;
end;
$$;

revoke all on function private.is_deleted_record(text, uuid) from public;
revoke all on function private.record_deletion() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_deleted_record(text, uuid) to authenticated;

create trigger orders_after_delete
  after delete on public.orders
  for each row execute function private.record_deletion();

-- ---------------------------------------------------------------------------
-- orders_before_write: unchanged from 20261010000000 except the guard at the top.
-- ---------------------------------------------------------------------------
create or replace function public.orders_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A device re-sending an order that was hard-deleted: skip it silently.
  if tg_op = 'INSERT' and private.is_deleted_record('orders', new.id) then
    return null;
  end if;

  -- Guard against phones with clocks set far in the future, which would
  -- otherwise win every conflict. Small drift (≤ 5 minutes) is tolerated.
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- Most recent change wins: silently skip stale or duplicate writes.
    -- The device picks up the newer server version on its next fetch.
    if new.updated_at <= old.updated_at then
      return null;
    end if;

    -- These never change after creation.
    new.id         := old.id;
    new.vendor_id  := old.vendor_id;
    new.created_at := old.created_at;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;
