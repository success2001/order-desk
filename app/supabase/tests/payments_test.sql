-- Task 7 tests: public.payments rules, sync trigger, row-level security, cascades.
--
-- Run after the migrations (npm run db:test). Creates two temporary vendors,
-- simulates each signing in, and removes everything it created at the end.
-- Any failed check raises an error, which rolls the whole test back.

do $$
declare
  vendor_a constant uuid := '00000000-0000-4000-a000-0000000000e1';
  vendor_b constant uuid := '00000000-0000-4000-a000-0000000000e2';
  order_a1 constant uuid := '00000000-0000-4000-b000-0000000000e1';
  order_a2 constant uuid := '00000000-0000-4000-b000-0000000000e2';
  order_b1 constant uuid := '00000000-0000-4000-b000-0000000000e3';
  pay_1    constant uuid := '00000000-0000-4000-c000-0000000000e1';
  pay_2    constant uuid := '00000000-0000-4000-c000-0000000000e2';
  -- now() is frozen for the whole transaction, so the timeline starts in the past.
  t0       constant timestamptz := now() - interval '1 hour';
  rec      public.payments%rowtype;
  n        int;
begin
  insert into auth.users (id, email, aud, role)
  values (vendor_a, 'payments-test-a@example.invalid', 'authenticated', 'authenticated'),
         (vendor_b, 'payments-test-b@example.invalid', 'authenticated', 'authenticated');
  insert into public.orders (id, vendor_id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (order_a1, vendor_a, 'Ada', '2x gown', 2500000, t0, t0),
         (order_a2, vendor_a, 'Ada', 'Head wrap', 500000, t0, t0),
         (order_b1, vendor_b, 'Bola', 'Shoes', 900000, t0, t0);

  -- ===== Signed in as vendor A =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A payment for the vendor's own order: owner filled in, server time stamped.
  insert into public.payments (id, order_id, amount_kobo, paid_at, method, created_at, updated_at)
  values (pay_1, order_a1, 1000000, t0, 'transfer', t0, t0);
  select * into rec from public.payments where id = pay_1;
  if rec.vendor_id is distinct from vendor_a or rec.server_updated_at is null then
    raise exception 'FAIL 1: owner or server time not set';
  end if;

  -- 2. Cannot attach a payment to another vendor's order (foreign key on (order_id, vendor_id)).
  begin
    insert into public.payments (order_id, amount_kobo, paid_at) values (order_b1, 100, t0);
    raise exception 'FAIL 2: payment attached to another vendor''s order';
  exception when foreign_key_violation then null;
  end;

  -- 3. Cannot create a payment as another vendor.
  begin
    insert into public.payments (order_id, vendor_id, amount_kobo, paid_at) values (order_b1, vendor_b, 100, t0);
    raise exception 'FAIL 3: payment created as another vendor';
  exception when insufficient_privilege then null;
  end;

  -- 4. Amounts: must be > ₦0 and ≤ ₦1bn.
  begin
    insert into public.payments (order_id, amount_kobo, paid_at) values (order_a1, 0, t0);
    raise exception 'FAIL 4a: ₦0 payment accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.payments (order_id, amount_kobo, paid_at) values (order_a1, -100, t0);
    raise exception 'FAIL 4b: negative payment accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.payments (order_id, amount_kobo, paid_at) values (order_a1, 100000000001, t0);
    raise exception 'FAIL 4c: payment over ₦1bn accepted';
  exception when check_violation then null;
  end;

  -- 5. Backdating: up to 90 days before it was recorded, not more.
  begin
    insert into public.payments (order_id, amount_kobo, paid_at, created_at, updated_at)
    values (order_a1, 100, t0 - interval '91 days', t0, t0);
    raise exception 'FAIL 5a: payment backdated more than 90 days accepted';
  exception when check_violation then null;
  end;
  insert into public.payments (id, order_id, amount_kobo, paid_at, created_at, updated_at)
  values (pay_2, order_a1, 500000, t0 - interval '89 days', t0, t0);
  select count(*) into n from public.payments where id = pay_2;
  if n <> 1 then raise exception 'FAIL 5b: payment backdated 89 days rejected'; end if;

  -- 6. Future paid_at is reset to server time.
  update public.payments set paid_at = now() + interval '1 year', updated_at = t0 + interval '1 minute' where id = pay_2;
  select * into rec from public.payments where id = pay_2;
  if rec.paid_at <> now() then raise exception 'FAIL 6: future paid_at not reset'; end if;

  -- 7. Method must be one of the known values (or empty).
  begin
    insert into public.payments (order_id, amount_kobo, paid_at, method) values (order_a1, 100, t0, 'bitcoin');
    raise exception 'FAIL 7: unknown method accepted';
  exception when check_violation then null;
  end;

  -- 8. Stale writes are skipped (most recent change wins).
  update public.payments set amount_kobo = 1, updated_at = t0 - interval '1 minute' where id = pay_1;
  select * into rec from public.payments where id = pay_1;
  if rec.amount_kobo <> 1000000 then raise exception 'FAIL 8: stale write applied'; end if;

  -- 9. The order, owner and creation time never change.
  update public.payments
     set order_id = order_a2, created_at = '2000-01-01', amount_kobo = 1200000, updated_at = t0 + interval '2 minutes'
   where id = pay_1;
  select * into rec from public.payments where id = pay_1;
  if rec.order_id <> order_a1 or rec.created_at <> t0 or rec.amount_kobo <> 1200000 then
    raise exception 'FAIL 9: immutable fields changed or edit not applied';
  end if;

  -- 10. Voiding is a soft delete; hard delete is not allowed.
  update public.payments set deleted_at = t0 + interval '3 minutes', updated_at = t0 + interval '3 minutes' where id = pay_2;
  select * into rec from public.payments where id = pay_2;
  if rec.deleted_at is null then raise exception 'FAIL 10a: void not applied'; end if;
  begin
    delete from public.payments where id = pay_1;
    raise exception 'FAIL 10b: vendor could hard-delete a payment';
  exception when insufficient_privilege then null;
  end;

  -- ===== Signed in as vendor B =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_b, 'role', 'authenticated')::text, true);

  -- 11. Vendor B cannot see or change vendor A's payments.
  select count(*) into n from public.payments where vendor_id = vendor_a;
  if n <> 0 then raise exception 'FAIL 11a: vendor B can read vendor A''s payments'; end if;
  update public.payments set amount_kobo = 1, updated_at = now() where id = pay_1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 11b: vendor B updated vendor A''s payment'; end if;

  -- ===== Not signed in (anon) =====
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;

  -- 12. Anonymous visitors have no access.
  begin
    select count(*) into n from public.payments;
    raise exception 'FAIL 12: anon could read payments';
  exception when insufficient_privilege then null;
  end;

  -- ===== Admin: hard-deleting an order removes and records its payments =====
  reset role;
  delete from public.orders where id = order_a1;

  -- 13. Its payments were deleted with it...
  select count(*) into n from public.payments where order_id = order_a1;
  if n <> 0 then raise exception 'FAIL 13: payments not removed with their order'; end if;

  -- 14. ...and recorded as deleted, with their owner.
  select count(*) into n from private.deleted_records
   where table_name = 'payments' and record_id in (pay_1, pay_2) and vendor_id = vendor_a;
  if n <> 2 then raise exception 'FAIL 14: deleted payments not recorded'; end if;

  -- ===== A device still holding them tries to send them again =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 15. A re-sent deleted payment is skipped silently (no error).
  insert into public.payments (id, order_id, amount_kobo, paid_at, created_at, updated_at)
  values (pay_1, order_a1, 1200000, t0, t0, t0 + interval '10 minutes')
  on conflict (id) do update set amount_kobo = excluded.amount_kobo, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 15: deleted payment re-created'; end if;

  -- 16. A new payment for the deleted order is skipped silently too (not a foreign key error).
  insert into public.payments (order_id, amount_kobo, paid_at) values (order_a1, 100, t0);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 16: payment for a deleted order stored'; end if;

  -- ===== Admin: account deletion removes the rest; clean up records =====
  reset role;
  delete from auth.users where id in (vendor_a, vendor_b);  -- cascades to orders and payments

  -- 17. Nothing of the test vendors is left.
  select count(*) into n from public.payments where vendor_id in (vendor_a, vendor_b);
  if n <> 0 then raise exception 'FAIL 17: payments left after account deletion'; end if;

  delete from private.deleted_records where vendor_id in (vendor_a, vendor_b);
end;
$$;

select 'ALL PAYMENTS TESTS PASSED' as result;
