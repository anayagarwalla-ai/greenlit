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

# Grant the scratch service role access to objects created by the migrations.
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 -c "
  grant all on all tables in schema auth, storage, public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema auth, storage, public to service_role;"

# 5. Run the functional checks (raises on any failed assertion)
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 \
  -f supabase/tests/01_atomic_rpc_functional_checks.sql
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 \
  -f supabase/tests/02_beta_blocker_regression_checks.sql
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 \
  -f supabase/tests/03_atomic_evidence_artifact_regression_checks.sql
psql -h /tmp/mp-pg-sock -p 5544 -U postgres -d mptest -v ON_ERROR_STOP=1 \
  -f supabase/tests/04_release_integrity_regression_checks.sql

# 6. Tear down
pg_ctl -D /tmp/mp-pgdata stop
```

`01_atomic_rpc_functional_checks.sql` exercises, against real Postgres (not
mocks):

- `queue_verification_job_atomic` creating a record + job atomically, requiring
  complete frozen automated-criterion coverage, and blocking a concurrent run.
- `lease_verification_job_atomic` / `complete_verification_job_atomic`
  transitioning a record to `READY_FOR_REVIEW` and clearing `active_job_id`,
  rejecting replayed leases, binding completion to private stored evidence,
  and allowing same-lease idempotent (`DUPLICATE`) re-completion.
- `create_review_packet_secure_atomic` binding a recipient to the record's
  current `last_run_id` and `criteria_revision`, and refusing to create a new
  packet once the record has moved past `READY_FOR_REVIEW` (stale-run
  protection).
- one-time, recipient-bound review-link redemption and review decisions
  committing their audit events in the same transaction, rejecting a
  mismatched reviewer email, and refusing a second decision.
- invoice-plan writes, Stripe connection history, test-mode draft creation,
  and out-of-order webhook protection.
- `retry_verification_job_atomic` succeeding when nothing has changed, and
  being rejected once the record's criteria/source changed since the job
  failed (revision-safety).
- staged evidence and record deletion remaining retryable and refusing to
  purge while either an artifact-level or record-level legal hold is present.
- privacy deletion removing only requester-owned records while preserving
  another agency's reviewer-matched legal record.

This found and fixed one real bug before it could reach production: a
`revoke`/`grant` statement for `queue_verification_job_atomic` in
`202607210001_external_beta_hardening.sql` listed one extra parameter type
versus the function's actual signature, which would have made the migration
fail outright on a fresh database (`function ... does not exist`).

`02_beta_blocker_regression_checks.sql` locks in the release-blocker fixes:
idempotent run creation, current-plan manual invoicing, recoverable Stripe
customer correction, receipt-link sessions, legal-hold/deletion mutual
exclusion, material milestone revision hashing, privacy/invoice serialization,
and complete offboarding of run, review, receipt, and financial workflows.

`03_atomic_evidence_artifact_regression_checks.sql` verifies immutable,
criterion-wide artifact slots, idempotent duplicate recording, stable stale
lease and completion rejection codes, zero-byte rejection, canonical retention
metadata, and internal-only function permissions.

`04_release_integrity_regression_checks.sql` verifies end-to-end immutable
evidence retry behavior, rejection of late evidence after completion, durable
Stripe webhook failure recovery, retry-payload binding, and the shared final
schema-version markers.
