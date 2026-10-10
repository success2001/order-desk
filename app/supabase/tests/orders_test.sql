-- T3 tests for public.orders: row-level security, sync trigger, constraints.
--
-- Run in the Supabase SQL Editor AFTER the migration.
-- It creates two temporary test users, simulates each one signing in, and
-- deletes everything it created at the end. Any failed check raises an error,
-- which rolls the whole test back. Success = a single row "ALL ORDERS TESTS PASSED".

do $$
declare
  vendor_a constant uuid := '00000000-0000-4000-a000-00000000000a';
  vendor_b constant uuid := '00000000-0000-4000-a000-00000000000b';
  order_a  constant uuid := '00000000-0000-4000-b000-0000000000a1';
  -- now() is frozen for the whole transaction, so the timeline starts in the
  -- past and later steps use times just after now() (inside the 5-minute drift allowance).
  t0       constant timestamptz := now() - interval '1 hour';
  n        int;
  rec      public.orders%rowtype;
  prev_server_ts timestamptz;
begin
  -- Setup: two test vendors (runs as the SQL Editor's admin role).
  insert into auth.users (id, email, aud, role)
  values (vendor_a, 'orders-test-a@example.invalid', 'authenticated', 'authenticated'),
         (vendor_b, 'orders-test-b@example.invalid', 'authenticated', 'authenticated');

  -- ===== Signed in as vendor A =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Vendor A can create an order; vendor_id is filled in automatically.
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (order_a, 'Ada', '2x Ankara gown', 2500000, t0, t0);
  select * into rec from public.orders where id = order_a;
  if rec.vendor_id is distinct from vendor_a then raise exception 'FAIL 1: vendor_id not set to signed-in user'; end if;

  -- 2. Vendor A cannot create an order on behalf of vendor B.
  begin
    insert into public.orders (customer_name, items, amount_due_kobo, vendor_id)
    values ('Mallory', 'x', 100, vendor_b);
    raise exception 'FAIL 2: inserted an order for another vendor';
  exception when insufficient_privilege then null;
  end;

  -- 3. Hard delete is not allowed (soft delete only).
  begin
    delete from public.orders where id = order_a;
    raise exception 'FAIL 3: hard delete was allowed';
  exception when insufficient_privilege then null;
  end;

  -- 4. Stale write is skipped (most recent change wins).
  update public.orders set customer_name = 'Stale', updated_at = t0 - interval '1 minute' where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.customer_name <> 'Ada' then raise exception 'FAIL 4: stale write overwrote newer data'; end if;

  -- 5. Duplicate write (same updated_at) is skipped.
  update public.orders set customer_name = 'Duplicate', updated_at = t0 where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.customer_name <> 'Ada' then raise exception 'FAIL 5: duplicate write was applied'; end if;

  -- 6. Newer write is applied and server_updated_at moves forward.
  prev_server_ts := rec.server_updated_at;
  update public.orders
     set amount_paid_kobo = 1000000, updated_at = t0 + interval '1 minute'
   where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.amount_paid_kobo <> 1000000 then raise exception 'FAIL 6a: newer write was not applied'; end if;
  if rec.server_updated_at <= prev_server_ts then raise exception 'FAIL 6b: server_updated_at did not advance'; end if;

  -- 7. A far-future device clock is clamped to server time.
  update public.orders set notes = 'future', updated_at = t0 + interval '1 year' where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.notes is distinct from 'future' then raise exception 'FAIL 7a: future-dated write was not applied'; end if;
  if rec.updated_at <> now() then raise exception 'FAIL 7b: future updated_at was not clamped to server time'; end if;

  -- 8. created_at cannot be changed after creation.
  update public.orders set created_at = '2000-01-01', updated_at = now() + interval '1 minute' where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.created_at <> t0 then raise exception 'FAIL 8: created_at was changed'; end if;

  -- 9. Soft delete works and still syncs (row remains, deleted_at set).
  update public.orders set deleted_at = now(), updated_at = now() + interval '2 minutes' where id = order_a;
  select * into rec from public.orders where id = order_a;
  if rec.deleted_at is null then raise exception 'FAIL 9: soft delete not applied'; end if;

  -- 10. Constraints: negative amounts and unknown statuses are rejected.
  begin
    insert into public.orders (customer_name, items, amount_due_kobo) values ('Bad', 'x', -1);
    raise exception 'FAIL 10a: negative amount accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.orders (customer_name, items, amount_due_kobo, fulfilment_status) values ('Bad', 'x', 1, 'lost');
    raise exception 'FAIL 10b: unknown fulfilment_status accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.orders (customer_name, items, amount_due_kobo) values ('   ', 'x', 1);
    raise exception 'FAIL 10c: blank customer_name accepted';
  exception when check_violation then null;
  end;

  -- ===== Signed in as vendor B =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_b, 'role', 'authenticated')::text, true);

  -- 11. Vendor B cannot see vendor A's order.
  select count(*) into n from public.orders where id = order_a;
  if n <> 0 then raise exception 'FAIL 11: vendor B can read vendor A''s order'; end if;

  -- 12. Vendor B cannot change vendor A's order (update silently matches no rows).
  update public.orders set customer_name = 'Hacked', updated_at = t0 + interval '1 hour' where id = order_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 12: vendor B updated vendor A''s order'; end if;

  -- ===== Not signed in (anon) =====
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;

  -- 13. Anonymous visitors have no access at all.
  begin
    select count(*) into n from public.orders;
    raise exception 'FAIL 13: anon could read orders';
  exception when insufficient_privilege then null;
  end;

  -- ===== Back to admin: verify B's attempt changed nothing, then clean up =====
  reset role;
  select * into rec from public.orders where id = order_a;
  if rec.customer_name <> 'Ada' then raise exception 'FAIL 12b: vendor A''s order was modified by vendor B'; end if;

  delete from auth.users where id in (vendor_a, vendor_b);  -- cascades to their orders
  select count(*) into n from public.orders where vendor_id in (vendor_a, vendor_b);
  if n <> 0 then raise exception 'FAIL 14: orders not removed when account deleted'; end if;

  -- The cascade recorded the deleted order (20261010120000_deleted_records);
  -- remove the record so this fixed test id can be inserted again next run.
  delete from private.deleted_records where table_name = 'orders' and record_id = order_a;
end;
$$;

select 'ALL ORDERS TESTS PASSED' as result;
