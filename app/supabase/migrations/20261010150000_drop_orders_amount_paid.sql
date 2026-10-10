-- Task 11: clean-up after the move to payment records (D16, D17).
--
-- 1. Drop orders.amount_paid_kobo. "Paid" is calculated from public.payments,
--    and since 3069b96 the app neither reads nor sends this column.
--    An app version from before that commit would now be refused when it
--    syncs an order ("column not found"); such builds were only ever used for
--    testing and must be reinstalled (see BUILD_PLAN.md D21).
--
-- 2. Fully validate the delivered_at check constraint added NOT VALID in
--    20261010130000. It already applies to every new or changed row; this also
--    checks existing rows (the table is empty in production, so nothing to fix).
--
-- Down (manual):
--   alter table public.orders
--     add column amount_paid_kobo bigint not null default 0 check (amount_paid_kobo >= 0);
--   (a validated constraint needs no undo)

alter table public.orders drop column amount_paid_kobo;

alter table public.orders validate constraint orders_delivered_at_only_when_delivered;
