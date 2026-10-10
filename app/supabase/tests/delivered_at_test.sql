-- Task 6 tests: delivered_at lifecycle and the trigger backstop on public.orders.
--
-- Run after the migrations (npm run db:test). Creates a temporary vendor,
-- simulates it signing in, and removes everything it created at the end.
-- Any failed check raises an error, which rolls the whole test back.

do $$
declare
  vendor constant uuid := '00000000-0000-4000-a000-0000000000d1';
  o1     constant uuid := '00000000-0000-4000-b000-0000000000d1';
  o2     constant uuid := '00000000-0000-4000-b000-0000000000d2';
  -- now() is frozen for the whole transaction, so the timeline starts in the past.
  t0     constant timestamptz := now() - interval '1 hour';
  rec    public.orders%rowtype;
  n      int;
begin
  insert into auth.users (id, email, aud, role)
  values (vendor, 'delivered-at-test@example.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', vendor, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A new pending order has no delivered_at, even if a device sends one.
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at, delivered_at)
  values (o1, 'Ada', '2x gown', 2500000, t0, t0, t0);
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is not null then raise exception 'FAIL 1: pending order kept a delivered_at'; end if;

  -- 2. Becoming delivered with the app's timestamp keeps that timestamp.
  update public.orders
     set fulfilment_status = 'delivered', delivered_at = t0 + interval '10 minutes', updated_at = t0 + interval '10 minutes'
   where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is distinct from t0 + interval '10 minutes' then raise exception 'FAIL 2: app delivered_at not kept'; end if;

  -- 3. Editing other fields of a delivered order (an upsert that doesn't send delivered_at) keeps it.
  update public.orders set items = '3x gown', updated_at = t0 + interval '20 minutes' where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is distinct from t0 + interval '10 minutes' then raise exception 'FAIL 3: edit changed delivered_at'; end if;

  -- 4. A stale write cannot change it (most recent change wins).
  update public.orders set fulfilment_status = 'pending', delivered_at = null, updated_at = t0 + interval '15 minutes' where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.fulfilment_status <> 'delivered' or rec.delivered_at is null then raise exception 'FAIL 4: stale write applied'; end if;

  -- 5. Reopening clears it, even if a device leaves the old value in place.
  update public.orders set fulfilment_status = 'pending', updated_at = t0 + interval '30 minutes' where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is not null then raise exception 'FAIL 5: reopen kept delivered_at'; end if;

  -- 6. Delivered again by an older app that sends no delivered_at: backstop uses updated_at.
  update public.orders set fulfilment_status = 'delivered', updated_at = t0 + interval '40 minutes' where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is distinct from t0 + interval '40 minutes' then raise exception 'FAIL 6: backstop did not set delivered_at'; end if;

  -- 7. Cancelling a delivered order clears it.
  update public.orders set fulfilment_status = 'cancelled', updated_at = t0 + interval '50 minutes' where id = o1;
  select * into rec from public.orders where id = o1;
  if rec.delivered_at is not null then raise exception 'FAIL 7: cancel kept delivered_at'; end if;

  -- 8. Created as delivered with a far-future delivered_at: reset to server time.
  insert into public.orders (id, customer_name, items, amount_due_kobo, fulfilment_status, created_at, updated_at, delivered_at)
  values (o2, 'Bayo', 'Small chops', 1850050, 'delivered', t0, t0, now() + interval '1 year');
  select * into rec from public.orders where id = o2;
  if rec.delivered_at <> now() then raise exception 'FAIL 8: future delivered_at not reset'; end if;

  -- ===== Admin checks and clean-up =====
  reset role;

  -- 9. The consistency rule is in place for new and changed rows.
  select count(*) into n from pg_constraint
   where conrelid = 'public.orders'::regclass and conname = 'orders_delivered_at_only_when_delivered';
  if n <> 1 then raise exception 'FAIL 9: delivered_at constraint missing'; end if;

  -- 10. (id, vendor_id) is unique, for the payments foreign key.
  select count(*) into n from pg_constraint
   where conrelid = 'public.orders'::regclass and conname = 'orders_id_vendor_key' and contype = 'u';
  if n <> 1 then raise exception 'FAIL 10: unique (id, vendor_id) missing'; end if;

  delete from auth.users where id = vendor;  -- cascades to the vendor's orders
  delete from private.deleted_records where table_name = 'orders' and record_id in (o1, o2);
end;
$$;

select 'ALL DELIVERED-AT TESTS PASSED' as result;
