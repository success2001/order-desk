-- Task 3 tests: hard-deleted orders cannot be re-created by a device that still holds them.
--
-- Run after the migrations (npm run db:test). Creates a temporary vendor,
-- simulates it signing in, and removes everything it created at the end.
-- Any failed check raises an error, which rolls the whole test back.

do $$
declare
  vendor  constant uuid := '00000000-0000-4000-a000-0000000000c1';
  deleted constant uuid := '00000000-0000-4000-b000-0000000000c1';
  kept    constant uuid := '00000000-0000-4000-b000-0000000000c2';
  t0      constant timestamptz := now() - interval '1 hour';
  n       int;
  flag    boolean;
begin
  insert into auth.users (id, email, aud, role)
  values (vendor, 'deleted-records-test@example.invalid', 'authenticated', 'authenticated');

  -- ===== Vendor creates an order; it is then hard-deleted on the server =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (deleted, 'Ada', '2x gown', 2500000, t0, t0);

  reset role;
  delete from public.orders where id = deleted;

  -- 1. The hard delete was recorded automatically, with its owner.
  select count(*) into n from private.deleted_records
   where table_name = 'orders' and record_id = deleted and vendor_id = vendor;
  if n <> 1 then raise exception 'FAIL 1: hard delete was not recorded'; end if;

  -- ===== A device that still holds the order tries to send it again =====
  perform set_config('request.jwt.claims', json_build_object('sub', vendor, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 2. Plain insert of the deleted id: no error, nothing stored.
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (deleted, 'Ada', '2x gown', 2500000, t0, t0 + interval '1 minute');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: deleted order was re-inserted'; end if;

  -- 3. The upsert the app actually sends (insert ... on conflict do update): no error, nothing stored.
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (deleted, 'Ada', 'edited offline', 2500000, t0, t0 + interval '2 minutes')
  on conflict (id) do update set items = excluded.items, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3: deleted order was re-created by upsert'; end if;

  -- 4. Other orders are unaffected: new inserts and updates still work.
  insert into public.orders (id, customer_name, items, amount_due_kobo, created_at, updated_at)
  values (kept, 'Bayo', 'Small chops', 1850050, t0, t0);
  update public.orders set items = 'Small chops for 20', updated_at = t0 + interval '1 minute' where id = kept;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 4: normal insert/update affected by the guard'; end if;

  -- 5. The vendor can ask whether an id was deleted (used by the trigger)...
  select private.is_deleted_record('orders', deleted) into flag;
  if not flag then raise exception 'FAIL 5: is_deleted_record did not report the deleted id'; end if;

  -- 6. ...but cannot read the list of deleted records.
  begin
    select count(*) into n from private.deleted_records;
    raise exception 'FAIL 6: signed-in user could read deleted_records';
  exception when insufficient_privilege then null;
  end;

  -- 7. Nor add to it (which could block someone else's future inserts).
  begin
    insert into private.deleted_records (table_name, record_id) values ('orders', gen_random_uuid());
    raise exception 'FAIL 7: signed-in user could write deleted_records';
  exception when insufficient_privilege then null;
  end;

  -- 8. Hard delete is still not allowed for vendors (soft delete only).
  begin
    delete from public.orders where id = kept;
    raise exception 'FAIL 8: vendor could hard-delete';
  exception when insufficient_privilege then null;
  end;

  -- ===== Not signed in (anon) =====
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;

  -- 9. Anonymous visitors cannot use the lookup at all.
  begin
    select private.is_deleted_record('orders', deleted) into flag;
    raise exception 'FAIL 9: anon could call is_deleted_record';
  exception when insufficient_privilege then null;
  end;

  -- ===== Admin: account deletion cascades and is recorded too =====
  reset role;
  select count(*) into n from public.orders where id = deleted;
  if n <> 0 then raise exception 'FAIL 10: deleted order exists after re-send attempts'; end if;

  delete from auth.users where id = vendor;  -- cascades to the vendor's orders
  select count(*) into n from private.deleted_records
   where table_name = 'orders' and record_id = kept and vendor_id = vendor;
  if n <> 1 then raise exception 'FAIL 11: cascade delete was not recorded'; end if;

  -- Clean up this test's records so its fixed ids can be reused next run.
  delete from private.deleted_records where table_name = 'orders' and record_id in (deleted, kept);
end;
$$;

select 'ALL DELETED-RECORDS TESTS PASSED' as result;
