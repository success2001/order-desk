-- Tests for public.deleted_records_since: own records only, stable paging, no anon access.
--
-- Run after the migrations (npm run db:test). Creates temporary vendors and
-- removes everything it created at the end. Any failed check raises an error,
-- which rolls the whole test back.

do $$
declare
  vendor_a constant uuid := '00000000-0000-4000-a000-0000000000f1';
  vendor_b constant uuid := '00000000-0000-4000-a000-0000000000f2';
  t0       constant timestamptz := now() - interval '1 hour';
  n        int;
  first_at timestamptz;
  first_table text;
  first_id uuid;
begin
  insert into auth.users (id, email, aud, role)
  values (vendor_a, 'since-test-a@example.invalid', 'authenticated', 'authenticated'),
         (vendor_b, 'since-test-b@example.invalid', 'authenticated', 'authenticated');

  -- Vendor A: three orders, one with a payment; vendor B: one order.
  insert into public.orders (id, vendor_id, customer_name, items, amount_due_kobo, created_at, updated_at) values
    ('00000000-0000-4000-b000-0000000000f1', vendor_a, 'A1', 'x', 100, t0, t0),
    ('00000000-0000-4000-b000-0000000000f2', vendor_a, 'A2', 'x', 100, t0, t0),
    ('00000000-0000-4000-b000-0000000000f3', vendor_a, 'A3', 'x', 100, t0, t0),
    ('00000000-0000-4000-b000-0000000000f4', vendor_b, 'B1', 'x', 100, t0, t0);
  insert into public.payments (id, vendor_id, order_id, amount_kobo, paid_at, created_at, updated_at)
  values ('00000000-0000-4000-c000-0000000000f1', vendor_a, '00000000-0000-4000-b000-0000000000f1', 50, t0, t0, t0);

  -- One statement deletes all four orders (and A1's payment by cascade): same deleted_at for all.
  delete from public.orders where vendor_id in (vendor_a, vendor_b);

  -- ===== Signed in as vendor A =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Sees exactly its own 3 orders + 1 cascaded payment, not vendor B's.
  select count(*) into n from public.deleted_records_since();
  if n <> 4 then raise exception 'FAIL 1: expected 4 own records, got %', n; end if;
  select count(*) into n from public.deleted_records_since() where record_id = '00000000-0000-4000-b000-0000000000f4';
  if n <> 0 then raise exception 'FAIL 1b: sees another vendor''s deletion'; end if;

  -- 2. Paging by position never skips rows that share a deleted_at.
  select r.deleted_at, r.table_name, r.record_id into first_at, first_table, first_id
    from public.deleted_records_since(null, null, null, 1) r;
  select count(*) into n from public.deleted_records_since(first_at, first_table, first_id, 1000);
  if n <> 3 then raise exception 'FAIL 2: paging after the first row returned % (expected 3)', n; end if;
  select count(*) into n from public.deleted_records_since(first_at, first_table, first_id, 1000) where record_id = first_id and table_name = first_table;
  if n <> 0 then raise exception 'FAIL 2b: page repeated the row it started after'; end if;

  -- 3. The page size is capped and at least 1.
  select count(*) into n from public.deleted_records_since(null, null, null, 0);
  if n <> 1 then raise exception 'FAIL 3: page size 0 not raised to 1'; end if;

  -- 4. Still cannot read the private table directly.
  begin
    select count(*) into n from private.deleted_records;
    raise exception 'FAIL 4: read private.deleted_records directly';
  exception when insufficient_privilege then null;
  end;

  -- ===== Vendor B sees only its own one =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor_b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.deleted_records_since();
  if n <> 1 then raise exception 'FAIL 5: vendor B expected 1 record, got %', n; end if;

  -- ===== Not signed in =====
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    select count(*) into n from public.deleted_records_since();
    raise exception 'FAIL 6: anon could call deleted_records_since';
  exception when insufficient_privilege then null;
  end;

  -- ===== Clean up =====
  reset role;
  delete from auth.users where id in (vendor_a, vendor_b);
  delete from private.deleted_records where vendor_id in (vendor_a, vendor_b);
end;
$$;

select 'ALL DELETED-RECORDS-SINCE TESTS PASSED' as result;
