# Migration validation (no Docker/Supabase CLI required)

These scripts let you validate the SQL migrations against a plain local
PostgreSQL instance when the Supabase CLI/Docker stack isn't available. They
are not a substitute for `supabase db reset` against the real CLI where that
is available — use this only as a fallback.

```bash
# 1. Start an isolated local Postgres (adjust paths/ports as needed)
initdb -D /tmp/mp-pgdata -U postgres --auth=trust
pg_ctl -D /tmp/mp-pgdata -o "-p 5544 -k /tmp/mp-pg-sock" -l /tmp/mp-pg.log start

# 2. Create roles + a scratch database
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -c "
  do \$\$ begin
    if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
  end \$\$;"
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -c "create database mptest;"

# 3. Stub the auth/storage/extensions schemas Supabase normally provides
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -f supabase/tests/00_local_supabase_stub.sql
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -c "
  alter role service_role bypassrls;
  grant usage on schema auth, storage, extensions, public to service_role;
  grant all on all tables in schema auth to service_role;
  grant all on all tables in schema storage to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema auth, storage, public to service_role;"

# 4. Apply every migration in order
for f in supabase/migrations/*.sql; do
  psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 -f "$f"
done

# 5. Run the functional checks (raises on any failed assertion)
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 \
  -f supabase/tests/01_atomic_rpc_functional_checks.sql

# 6. Tear down
pg_ctl -D /tmp/mp-pgdata stop
```

`01_atomic_rpc_functional_checks.sql` exercises, against real Postgres (not
mocks):

- `queue_verification_job_atomic` creating a record + job atomically, and its
  active-job guard blocking a second concurrent queue attempt.
- `lease_verification_job_atomic` / `complete_verification_job_atomic`
  transitioning a record to `READY_FOR_REVIEW` and clearing `active_job_id`,
  with idempotent (`DUPLICATE`) re-completion.
- `create_review_packet_atomic` binding to the record's current `last_run_id`
  and `criteria_revision`, and refusing to create a new packet once the
  record has moved past `READY_FOR_REVIEW` (stale-run protection).
- `record_review_decision_atomic` refusing a second decision on an
  already-decided packet.
- `retry_verification_job_atomic` succeeding when nothing has changed, and
  being rejected once the record's criteria/source changed since the job
  failed (revision-safety).
- `purge_expired_evidence_atomic` refusing to delete a legal-held artifact.
- `purge_expired_transaction_record` refusing to purge while either an
  artifact-level or record-level legal hold is present, and succeeding once
  both are cleared.

This found and fixed one real bug before it could reach production: a
`revoke`/`grant` statement for `queue_verification_job_atomic` in
`202607210001_external_beta_hardening.sql` listed one extra parameter type
versus the function's actual signature, which would have made the migration
fail outright on a fresh database (`function ... does not exist`).
