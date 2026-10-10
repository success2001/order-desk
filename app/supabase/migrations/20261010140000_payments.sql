-- Task 7: payment history. Each payment received is its own dated row, so
-- "revenue this month" counts money by when it arrived, and payments recorded
-- on two devices at the same time both survive (instead of one overwriting a
-- running total on the order).
--
-- Rules (product decisions, 2026-10-10):
--   * amount > ₦0, at most ₦1,000,000,000 (catches typing mistakes)
--   * paid_at may be backdated up to 90 days before the payment was recorded,
--     never in the future (future times are reset to server time)
--   * payments on cancelled orders still count until voided; voiding (and
--     refunds) = setting deleted_at
--   * method is optional: transfer, cash, pos, other
--
-- Down (manual): drop table public.payments cascade;
--   drop function public.payments_before_write();

create table public.payments (
  -- Generated on the device so payments can be recorded offline.
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  order_id          uuid not null,

  -- Money in kobo (₦1 = 100 kobo).
  amount_kobo       bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  -- When the money was received (may be backdated, see rules above).
  paid_at           timestamptz not null,
  method            text check (method in ('transfer', 'cash', 'pos', 'other')),
  note              text check (char_length(note) <= 500),

  -- Device clock: used for "most recent change wins".
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Voided payments (and refunds) keep their row so the change syncs.
  deleted_at        timestamptz,

  -- Server clock: used by devices to fetch changes since their last sync.
  server_updated_at timestamptz not null default now(),

  constraint payments_paid_at_within_90_days check (paid_at >= created_at - interval '90 days'),
  -- A payment can only belong to an order of the same vendor; removed with its order.
  constraint payments_order_fk foreign key (order_id, vendor_id)
    references public.orders (id, vendor_id) on delete cascade
);

create index payments_vendor_sync_idx on public.payments (vendor_id, server_updated_at);
create index payments_order_idx on public.payments (order_id);

-- ---------------------------------------------------------------------------
-- Write trigger: same sync rules as orders_before_write.
-- ---------------------------------------------------------------------------
create function public.payments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Re-sent deleted payments, and payments for deleted orders: skip silently
  -- (a rejection would leave them "not backed up" on the device forever).
  if tg_op = 'INSERT' and (
    private.is_deleted_record('payments', new.id) or private.is_deleted_record('orders', new.order_id)
  ) then
    return null;
  end if;

  -- Phones with clocks far in the future would otherwise win every conflict
  -- and record payments as received in the future.
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;
  if new.paid_at > now() + interval '5 minutes' then
    new.paid_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- Most recent change wins: silently skip stale or duplicate writes.
    if new.updated_at <= old.updated_at then
      return null;
    end if;

    -- These never change after creation.
    new.id         := old.id;
    new.vendor_id  := old.vendor_id;
    new.order_id   := old.order_id;
    new.created_at := old.created_at;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger payments_before_write
  before insert or update on public.payments
  for each row execute function public.payments_before_write();

-- Hard deletes (dashboard, SQL, or cascades from orders/accounts) are recorded
-- like orders' (20261010120000_deleted_records).
create trigger payments_after_delete
  after delete on public.payments
  for each row execute function private.record_deletion();

-- ---------------------------------------------------------------------------
-- Row-level security: a vendor can only see and change their own payments.
-- No delete policy: clients void via deleted_at.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;

revoke all on public.payments from anon;
revoke all on public.payments from authenticated;
grant select, insert, update on public.payments to authenticated;

create policy "Vendors read own payments"
  on public.payments for select
  to authenticated
  using (vendor_id = (select auth.uid()));

create policy "Vendors create own payments"
  on public.payments for insert
  to authenticated
  with check (vendor_id = (select auth.uid()));

create policy "Vendors update own payments"
  on public.payments for update
  to authenticated
  using (vendor_id = (select auth.uid()))
  with check (vendor_id = (select auth.uid()));
