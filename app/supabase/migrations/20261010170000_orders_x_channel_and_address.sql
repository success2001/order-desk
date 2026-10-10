-- Orders can come from X, and the delivery address gets its own field
-- (it used to go in notes).
--
-- Both changes only widen what's allowed, so existing rows and older app
-- versions keep working: old versions never send 'x' or delivery_address.
--
-- Down (manual, only if no order uses 'x'):
--   alter table public.orders drop column delivery_address;
--   alter table public.orders drop constraint orders_channel_check;
--   alter table public.orders add constraint orders_channel_check
--     check (channel in ('whatsapp', 'instagram', 'other'));

alter table public.orders drop constraint orders_channel_check;
alter table public.orders add constraint orders_channel_check
  check (channel in ('whatsapp', 'instagram', 'x', 'other'));

alter table public.orders add column delivery_address text
  check (char_length(delivery_address) <= 500);
