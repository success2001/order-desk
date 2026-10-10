-- Tell devices about hard deletes (BUILD_PLAN.md open question 4).
--
-- A device that already holds an order or payment hard-deleted on the server
-- kept showing it, and its changes were silently skipped (D13). Devices now
-- fetch their own vendor's deletion records during sync and remove those rows.
--
-- private.deleted_records stays private; this function returns only the signed-in
-- vendor's records, in a stable order for paging. Paging uses the position
-- (deleted_at, table_name, record_id), not just the time: rows deleted together
-- share one deleted_at (a cascade or a multi-row dashboard delete), so "after
-- this time" alone could skip some of them across a page boundary.
--
-- Down (manual): drop function public.deleted_records_since(timestamptz, text, uuid, integer);

create function public.deleted_records_since(
  p_after_at    timestamptz default null,
  p_after_table text        default null,
  p_after_id    uuid        default null,
  p_limit       integer     default 500
)
returns table (table_name text, record_id uuid, deleted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.table_name, d.record_id, d.deleted_at
    from private.deleted_records d
   where d.vendor_id = (select auth.uid())
     and (
       p_after_at is null
       or (d.deleted_at, d.table_name, d.record_id)
          > (p_after_at, coalesce(p_after_table, ''), coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
     )
   order by d.deleted_at, d.table_name, d.record_id
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.deleted_records_since(timestamptz, text, uuid, integer) from public, anon;
grant execute on function public.deleted_records_since(timestamptz, text, uuid, integer) to authenticated;
