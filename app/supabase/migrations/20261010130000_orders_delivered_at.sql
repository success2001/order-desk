-- Task 6: when an order was delivered, so "delivered this month" can be counted
-- accurately (updated_at changes on every edit, so it can't stand in).
--
-- Lifecycle (set by the app, enforced here as a backstop for older app versions):
--   becomes delivered        -> delivered_at = time of that change
--   stays delivered          -> unchanged
--   leaves delivered         -> null (reopen, cancel, back to dispatched)
--   delivered again later    -> new time (the order counts in the month of its latest delivery)
--
-- Also adds unique (id, vendor_id), which the payments table's foreign key needs
-- so a payment can never reference another vendor's order.
--
-- Down (manual, in this order):
--   re-run the orders_before_write definition from 20261010120000_deleted_records.sql;
--   alter table public.orders drop constraint orders_delivered_at_only_when_delivered;
--   alter table public.orders drop constraint orders_id_vendor_key;
--   alter table public.orders drop column delivered_at;

alter table public.orders add column delivered_at timestamptz;

alter table public.orders add constraint orders_id_vendor_key unique (id, vendor_id);

-- delivered_at is set exactly when the order is delivered. NOT VALID: enforced for
-- every new or changed row; existing rows (none in production) aren't re-checked.
alter table public.orders add constraint orders_delivered_at_only_when_delivered
  check ((fulfilment_status = 'delivered') = (delivered_at is not null)) not valid;

-- ---------------------------------------------------------------------------
-- orders_before_write: unchanged from 20261010120000 except the delivered_at block.
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

  -- delivered_at belongs to the delivered status. The app sets it; this keeps
  -- rows consistent if a device (e.g. an older app version) doesn't.
  if new.fulfilment_status = 'delivered' then
    if new.delivered_at is null then
      new.delivered_at := new.updated_at;
    elsif new.delivered_at > now() + interval '5 minutes' then
      new.delivered_at := now();
    end if;
  else
    new.delivered_at := null;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;
