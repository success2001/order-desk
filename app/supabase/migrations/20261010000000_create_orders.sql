-- T3: orders table, row-level security and sync support.
-- See BUILD_PLAN.md §3 (data model, sync rules, security).

create table public.orders (
  -- Generated on the device so orders can be created offline.
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,

  customer_name     text not null check (char_length(btrim(customer_name)) between 1 and 200),
  customer_phone    text check (char_length(customer_phone) <= 30),
  channel           text not null default 'whatsapp'
                      check (channel in ('whatsapp', 'instagram', 'other')),
  items             text not null check (char_length(btrim(items)) between 1 and 2000),

  -- Money in kobo (₦1 = 100 kobo) to avoid rounding errors.
  amount_due_kobo   bigint not null check (amount_due_kobo >= 0),
  amount_paid_kobo  bigint not null default 0 check (amount_paid_kobo >= 0),

  fulfilment_status text not null default 'pending'
                      check (fulfilment_status in ('pending', 'dispatched', 'delivered', 'cancelled')),
  notes             text check (char_length(notes) <= 2000),

  -- Device clock: used for "most recent change wins".
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Soft delete so deletions sync to other devices.
  deleted_at        timestamptz,

  -- Server clock: used by devices to fetch changes since their last sync.
  server_updated_at timestamptz not null default now()
);

-- Payment status (unpaid / part-paid / paid) is derived from the amounts and deliberately not stored.

create index orders_vendor_sync_idx on public.orders (vendor_id, server_updated_at);

-- ---------------------------------------------------------------------------
-- Sync trigger
-- ---------------------------------------------------------------------------
create function public.orders_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger orders_before_write
  before insert or update on public.orders
  for each row execute function public.orders_before_write();

-- ---------------------------------------------------------------------------
-- Row-level security: a vendor can only see and change their own orders.
-- No delete policy: clients soft-delete via deleted_at. Rows are removed
-- only when the vendor's account is deleted (on delete cascade).
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;

revoke all on public.orders from anon;
revoke all on public.orders from authenticated;
grant select, insert, update on public.orders to authenticated;

create policy "Vendors read own orders"
  on public.orders for select
  to authenticated
  using (vendor_id = (select auth.uid()));

create policy "Vendors create own orders"
  on public.orders for insert
  to authenticated
  with check (vendor_id = (select auth.uid()));

create policy "Vendors update own orders"
  on public.orders for update
  to authenticated
  using (vendor_id = (select auth.uid()))
  with check (vendor_id = (select auth.uid()));
