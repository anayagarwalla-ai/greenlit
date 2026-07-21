\set ON_ERROR_STOP on
set role service_role;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_result jsonb;
  v_record_id uuid;
  v_job_id uuid;
  v_job2_id uuid;
  v_failed jsonb;
  v_outcome text;
  v_packet_id uuid;
  v_overlapping_packet_id uuid;
  v_record public.transaction_records;
  v_evidence_id1 uuid := gen_random_uuid();
  v_evidence_id2 uuid := gen_random_uuid();
  v_retry_result jsonb;
  v_purge boolean;
  v_count integer;
begin
  insert into auth.users(id, email) values (v_owner, 'agency@example.test');

  -- 1) Queue a brand-new record + job atomically.
  v_result := queue_verification_job_atomic(
    null, 'MP-TEST01', v_owner, 'hash1', 'IMPORTED_FIXTURE',
    'Agency', 'Client', 'Project', 'Milestone', 1000, 'USD',
    'sow.txt', 'srchash1', '[{"id":"AC-01"}]'::jsonb, 'critHash1',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    '[{"criterionId":"AC-01"}]'::jsonb, '0.5.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
  );
  v_record_id := (v_result->>'recordId')::uuid;
  v_job_id := (v_result->>'jobId')::uuid;
  assert (v_result->>'criteriaRevision')::int = 1, 'expected initial criteria revision 1';
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'VERIFYING', 'new record should be VERIFYING after queue';
  assert v_record.active_job_id = v_job_id, 'active_job_id should point at the queued job';
  raise notice 'CHECK 1 PASSED: queue_verification_job_atomic creates record + job atomically';

  -- 2) A second queue attempt while a job is active must be rejected (active-job guard).
  begin
    perform queue_verification_job_atomic(
      v_record_id, 'MP-TEST01', v_owner, 'hash1', 'IMPORTED_FIXTURE',
      'Agency', 'Client', 'Project', 'Milestone', 1000, 'USD',
      'sow.txt', 'srchash1', '[{"id":"AC-01"}]'::jsonb, 'critHash1',
      'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
      '[{"criterionId":"AC-01"}]'::jsonb, '0.5.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
    );
    raise exception 'CHECK 2 FAILED: expected active-job guard to reject a concurrent queue attempt';
  exception when others then
    if sqlerrm like 'CHECK 2 FAILED%' then raise; end if;
    raise notice 'CHECK 2 PASSED: active-job guard rejected concurrent queue attempt (%.)', sqlerrm;
  end;

  -- 3) Lease then complete the job; record should become READY_FOR_REVIEW on an all-PASS result.
  perform lease_verification_job_atomic(v_job_id, 1);
  v_outcome := complete_verification_job_atomic(
    v_job_id, 1,
    '[{"criterionId":"AC-01","status":"PASS","expected":"x","observed":"y","durationMs":10,"timestamp":"2026-07-20T00:00:00.000Z","evidenceId":"path1","evidenceHash":"deadbeef"}]'::jsonb,
    '[{"criterionId":"AC-01","kind":"SCREENSHOT","sha256":"deadbeef","storagePath":"path1"}]'::jsonb,
    'chromium', '0.5.0', 'manifestHash1', now(), now()
  );
  assert v_outcome = 'READY_FOR_REVIEW', 'expected READY_FOR_REVIEW outcome, got ' || v_outcome;
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'READY_FOR_REVIEW', 'record should be READY_FOR_REVIEW after passing completion';
  assert v_record.active_job_id is null, 'active_job_id should clear on completion';
  assert v_record.last_run_id = v_job_id, 'last_run_id should point at the completed job';
  raise notice 'CHECK 3 PASSED: lease + complete transition record to READY_FOR_REVIEW and clear active_job_id';

  -- 4) Completing an already-COMPLETED job again must be a safe no-op (duplicate), not a mutation.
  v_outcome := complete_verification_job_atomic(
    v_job_id, 1,
    '[{"criterionId":"AC-01","status":"PASS","expected":"x","observed":"y","durationMs":10,"timestamp":"2026-07-20T00:00:00.000Z","evidenceId":"path1","evidenceHash":"deadbeef"}]'::jsonb,
    '[{"criterionId":"AC-01","kind":"SCREENSHOT","sha256":"deadbeef","storagePath":"path1"}]'::jsonb,
    'chromium', '0.5.0', 'manifestHash1', now(), now()
  );
  assert v_outcome = 'DUPLICATE', 'expected DUPLICATE on re-completion, got ' || v_outcome;
  raise notice 'CHECK 4 PASSED: re-completing a COMPLETED job is a safe idempotent no-op';

  -- 5) Create a review packet bound to the current last_run_id + criteria revision.
  v_packet_id := create_review_packet_atomic(
    v_record_id, v_job_id, 'REVIEW-TEST01',
    jsonb_build_object('recordId', v_record_id, 'run', jsonb_build_object('runId', v_job_id), 'revision', 1),
    'snapHash1', 'bearerHash1', now() + interval '72 hours', 'actorHash1', 1
  );
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'record should be IN_REVIEW after review packet creation';
  raise notice 'CHECK 5 PASSED: create_review_packet_atomic binds to current run + revision and flips record to IN_REVIEW';

  -- 6) Revoking an older packet cannot reopen a record while another active packet exists.
  insert into review_packets_v2(record_id, run_id, public_id, snapshot, snapshot_sha256, bearer_token_hash, expires_at, criteria_revision)
  values (v_record_id, v_job_id, 'REVIEW-TEST01-OVERLAP', jsonb_build_object('recordId', v_record_id, 'run', jsonb_build_object('runId', v_job_id), 'revision', 1), 'snapHashOverlap', 'bearerHashOverlap', now() + interval '48 hours', 1)
  returning id into v_overlapping_packet_id;
  perform manage_review_packet_atomic(v_packet_id, v_owner, 'revoke', 'actorHash1', now());
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'revoking an older packet must not reopen a record with another active packet';
  assert exists (select 1 from review_packets_v2 where id = v_packet_id and revoked_at is not null), 'revoked packet should retain its revocation timestamp';
  perform manage_review_packet_atomic(v_overlapping_packet_id, v_owner, 'revoke', 'actorHash1', now());
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'READY_FOR_REVIEW', 'revoking the final active packet should restore READY_FOR_REVIEW';

  v_packet_id := create_review_packet_atomic(
    v_record_id, v_job_id, 'REVIEW-TEST01-REPLACEMENT',
    jsonb_build_object('recordId', v_record_id, 'run', jsonb_build_object('runId', v_job_id), 'revision', 1),
    'snapHash1b', 'bearerHash1b', now() + interval '72 hours', 'actorHash1', 1
  );
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'replacement packet should put the record back IN_REVIEW';
  raise notice 'CHECK 6 PASSED: revoke preserves other active reviews, then restores READY_FOR_REVIEW for replacement';

  -- 7) Decision, record state, audit event, and durable owner notification commit atomically.
  perform record_review_decision_with_notification_atomic(v_packet_id, 'APPROVED', 'Reviewer', 'reviewer@example.test', 'looks good', '2026-07-20', 'actorHash2', 'US', now(), 'receiptHash1', 'IN_APP');
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'APPROVED', 'record should be APPROVED after decision';
  assert exists (
    select 1 from operator_notifications
    where owner_user_id = v_owner and record_id = v_record_id and event_type = 'APPROVED'
  ), 'decision transaction should create its durable owner notification';
  begin
    perform record_review_decision_with_notification_atomic(v_packet_id, 'APPROVED', 'Reviewer', 'reviewer@example.test', 'again', '2026-07-20', 'actorHash2', 'US', now(), 'receiptHash2', 'IN_APP');
    raise exception 'CHECK 7 FAILED: a second decision on the same packet must be rejected';
  exception when others then
    if sqlerrm like 'CHECK 7 FAILED%' then raise; end if;
    raise notice 'CHECK 7 PASSED: atomic decision created the notification and rejected a second decision (%.)', sqlerrm;
  end;

  -- 8) A stale run cannot be turned into a NEW review after the record has moved past READY_FOR_REVIEW.
  begin
    perform create_review_packet_atomic(
      v_record_id, v_job_id, 'REVIEW-TEST02',
      jsonb_build_object('recordId', v_record_id, 'run', jsonb_build_object('runId', v_job_id), 'revision', 1),
      'snapHash2', 'bearerHash2', now() + interval '72 hours', 'actorHash1', 1
    );
    raise exception 'CHECK 8 FAILED: expected stale-run guard to reject reviewing an APPROVED record''s old run';
  exception when others then
    if sqlerrm like 'CHECK 8 FAILED%' then raise; end if;
    raise notice 'CHECK 8 PASSED: cannot create a new review packet once the record is APPROVED (%.)', sqlerrm;
  end;

  -- 9) A failed job with a stale criteria revision cannot be retried; one with a current revision can.
  v_result := queue_verification_job_atomic(
    null, 'MP-TEST02', v_owner, 'hash2', 'IMPORTED_FIXTURE',
    'Agency', 'Client', 'Project2', 'Milestone2', 2000, 'USD',
    'sow2.txt', 'srchash2', '[{"id":"AC-01"}]'::jsonb, 'critHash2',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    '[{"criterionId":"AC-01"}]'::jsonb, '0.5.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
  );
  v_job2_id := (v_result->>'jobId')::uuid;
  perform fail_verification_job_atomic(v_job2_id, 1, 'synthetic failure', 'VERIFICATION_FAILED');
  select * into v_record from transaction_records where id = (v_result->>'recordId')::uuid;
  assert v_record.status = 'READY', 'record should return to READY after job failure';
  assert v_record.active_job_id is null, 'active_job_id should clear on failure';

  v_retry_result := retry_verification_job_atomic(v_job2_id, 'operator@example.test');
  assert v_retry_result is not null, 'retry should succeed when the record has not changed since the failed job';
  raise notice 'CHECK 9a PASSED: retry succeeds when the record''s criteria revision has not changed';

  -- Fail the retried job too, then bump the record's criteria (new run supersedes it), and confirm retry of the ORIGINAL failed job is now rejected as stale.
  perform fail_verification_job_atomic((v_retry_result->>'jobId')::uuid, 1, 'synthetic failure 2', 'VERIFICATION_FAILED');
  perform queue_verification_job_atomic(
    (v_result->>'recordId')::uuid, 'MP-TEST02', v_owner, 'hash2', 'IMPORTED_FIXTURE',
    'Agency', 'Client', 'Project2', 'Milestone2', 2000, 'USD',
    'sow2.txt', 'srchash2-changed', '[{"id":"AC-01"}]'::jsonb, 'critHash2-changed',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    '[{"criterionId":"AC-01"}]'::jsonb, '0.5.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
  );
  perform fail_verification_job_atomic((select id from verification_jobs_v2 where record_id = (v_result->>'recordId')::uuid and status in ('QUEUED','LEASED','RUNNING')), 1, 'synthetic failure 3', 'VERIFICATION_FAILED');
  begin
    perform retry_verification_job_atomic(v_job2_id, 'operator@example.test');
    raise exception 'CHECK 9b FAILED: retrying a job whose record has since changed criteria must be rejected';
  exception when others then
    if sqlerrm like 'CHECK 9b FAILED%' then raise; end if;
    raise notice 'CHECK 9b PASSED: retry is rejected once the record''s criteria/source changed since the failed job (%.)', sqlerrm;
  end;

  -- 10) Staged evidence deletion respects both record and artifact holds and remains retryable.
  insert into evidence_artifacts_v2(id, record_id, run_id, criterion_id, kind, storage_path, mime_type, byte_size, sha256, expires_at, legal_hold)
  values (v_evidence_id1, v_record_id, v_job_id, 'AC-01', 'SCREENSHOT', 'held/path.png', 'image/png', 10, 'deadbeef', now() - interval '1 day', true);
  insert into evidence_artifacts_v2(id, record_id, run_id, criterion_id, kind, storage_path, mime_type, byte_size, sha256, expires_at, legal_hold)
  values (v_evidence_id2, v_record_id, v_job_id, 'AC-02', 'SCREENSHOT', 'free/path.png', 'image/png', 10, 'cafebabe', now() - interval '1 day', false);

  update transaction_records set legal_hold = true where id = v_record_id;
  perform stage_expired_evidence_deletion(100, now());
  assert (select deletion_status from evidence_artifacts_v2 where id = v_evidence_id2) = 'ACTIVE', 'record hold should block staging otherwise eligible evidence';
  update transaction_records set legal_hold = false where id = v_record_id;

  perform stage_expired_evidence_deletion(100, now());
  assert (select deletion_status from evidence_artifacts_v2 where id = v_evidence_id2) = 'PENDING', 'eligible evidence should enter PENDING before storage deletion';
  assert (select deletion_status from evidence_artifacts_v2 where id = v_evidence_id1) = 'ACTIVE', 'held evidence must remain ACTIVE';
  v_count := fail_evidence_deletion_atomic(array[v_evidence_id2], v_record_id, 'synthetic storage failure', now());
  assert v_count = 1, 'one failed evidence deletion should be recorded';
  assert (select deletion_status from evidence_artifacts_v2 where id = v_evidence_id2) = 'FAILED', 'storage failure should leave a visible retryable FAILED row';

  perform stage_expired_evidence_deletion(100, now());
  assert (select deletion_status from evidence_artifacts_v2 where id = v_evidence_id2) = 'PENDING', 'failed deletion should be stageable for retry';
  v_count := finalize_evidence_deletion_atomic(array[v_evidence_id2], v_record_id, now());
  assert v_count = 1, 'one staged artifact should finalize';
  assert not exists (select 1 from evidence_artifacts_v2 where id = v_evidence_id2), 'finalized evidence should be deleted';
  assert exists (select 1 from evidence_artifacts_v2 where id = v_evidence_id1), 'held evidence must remain';
  raise notice 'CHECK 10 PASSED: evidence deletion is staged, hold-aware, failure-visible, retryable, and finalizable';

  -- 11) Record deletion is staged before destructive cleanup and remains hold-aware.
  update transaction_records set retention_until = now() - interval '1 day' where id = v_record_id;
  perform stage_expired_record_deletion(50, now());
  assert (select deletion_status from transaction_records where id = v_record_id) = 'ACTIVE', 'held artifact should block staging its record';
  raise notice 'CHECK 11a PASSED: artifact-level legal hold blocks record deletion staging';

  update evidence_artifacts_v2 set legal_hold = false where id = v_evidence_id1;
  update transaction_records set legal_hold = true where id = v_record_id;
  perform stage_expired_record_deletion(50, now());
  assert (select deletion_status from transaction_records where id = v_record_id) = 'ACTIVE', 'record hold should block deletion staging';
  raise notice 'CHECK 11b PASSED: record-level legal hold blocks deletion staging';

  update transaction_records set legal_hold = false where id = v_record_id;
  perform stage_expired_record_deletion(50, now());
  assert (select deletion_status from transaction_records where id = v_record_id) = 'PENDING', 'eligible record should enter PENDING before destructive cleanup';
  v_purge := finalize_expired_record_deletion(v_record_id);
  assert v_purge = true, 'record deletion should finalize once retention has passed and no holds remain';
  assert not exists (select 1 from transaction_records where id = v_record_id), 'record should be gone after purge';
  assert exists (select 1 from operational_events where event_type = 'TRANSACTION_RECORD_PURGED' and details->>'recordId' = v_record_id::text), 'finalization should leave a non-record operational receipt';
  raise notice 'CHECK 11c PASSED: staged record deletion finalizes atomically and retains an operational receipt';

  raise notice '=== ALL FUNCTIONAL CHECKS PASSED ===';
end $$;
