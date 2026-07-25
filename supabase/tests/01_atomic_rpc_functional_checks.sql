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
  v_receipt_grant_id uuid;
  v_replacement_receipt_grant_id uuid;
  v_record public.transaction_records;
  v_evidence_id1 uuid := gen_random_uuid();
  v_evidence_id2 uuid := gen_random_uuid();
  v_retry_result jsonb;
  v_purge boolean;
  v_count integer;
  v_privacy_owner uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_owned_record_id uuid;
  v_reviewed_record_id uuid;
  v_reviewed_job_id uuid;
  v_privacy_request_id uuid := gen_random_uuid();
  v_lease_id uuid := gen_random_uuid();
  v_job2_lease_id uuid := gen_random_uuid();
  v_retry_lease_id uuid := gen_random_uuid();
  v_changed_lease_id uuid := gen_random_uuid();
  v_invoice_job public.invoice_jobs;
  v_criteria jsonb := '[{"id":"AC-01","title":"Criterion","sourceQuote":"Required source quote","supported":true,"checkType":"element_state"}]'::jsonb;
  v_checks jsonb := '[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Required source quote","confirmedByHuman":true,"elementRef":"main:Content","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id, email) values (v_owner, 'agency@example.test');
  insert into beta_invites(email,status,adult_sponsor,invited_by) values('agency@example.test','ACTIVE','Test operator','migration test');

  -- 0) The database itself rejects a run that omits any frozen automated criterion.
  begin
    perform queue_verification_job_atomic(
      null, 'MP-MISSING-COVERAGE', v_owner, 'hash0', 'IMPORTED_FIXTURE',
      'Agency', 'Client', 'Project', 'Milestone', 1000, 'USD',
      'sow.txt', 'source0', v_criteria || '[{"id":"AC-02","title":"Second","sourceQuote":"Second required quote","supported":true,"checkType":"element_state"}]'::jsonb, 'criteria0',
      'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
      v_checks, '0.7.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
    );
    raise exception 'CHECK 0 FAILED: expected incomplete automated-criterion coverage to be rejected';
  exception when others then
    if sqlerrm like 'CHECK 0 FAILED%' then raise; end if;
    raise notice 'CHECK 0 PASSED: incomplete automated-criterion coverage was rejected (%.)', sqlerrm;
  end;

  -- 1) Queue a brand-new record + job atomically.
  v_result := queue_verification_job_atomic(
    null, 'MP-TEST01', v_owner, 'hash1', 'IMPORTED_FIXTURE',
    'Agency', 'Client', 'Project', 'Milestone', 1000, 'USD',
    'sow.txt', 'srchash1', v_criteria, 'critHash1',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    v_checks, '0.7.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
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
      'sow.txt', 'srchash1', v_criteria, 'critHash1',
      'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
      v_checks, '0.7.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
    );
    raise exception 'CHECK 2 FAILED: expected active-job guard to reject a concurrent queue attempt';
  exception when others then
    if sqlerrm like 'CHECK 2 FAILED%' then raise; end if;
    raise notice 'CHECK 2 PASSED: active-job guard rejected concurrent queue attempt (%.)', sqlerrm;
  end;

  -- 3) Lease then complete the job; record should become READY_FOR_REVIEW on an all-PASS result.
  perform lease_verification_job_atomic(v_job_id, 1, v_lease_id);
  begin
    perform lease_verification_job_atomic(v_job_id, 1, gen_random_uuid());
    raise exception 'CHECK 2b FAILED: expected a replayed lease claim to be rejected';
  exception when others then
    if sqlerrm like 'CHECK 2b FAILED%' then raise; end if;
    raise notice 'CHECK 2b PASSED: a concurrent or replayed lease claim was rejected (%.)', sqlerrm;
  end;
  insert into evidence_artifacts_v2(record_id,run_id,criterion_id,kind,storage_path,mime_type,byte_size,sha256,expires_at)
  values(v_record_id,v_job_id,'AC-01','SCREENSHOT','path1','image/png',10,'deadbeef',now()+interval '90 days');
  v_outcome := complete_verification_job_atomic(
    v_job_id, 1, v_lease_id,
    '[{"criterionId":"AC-01","status":"PASS","expected":"x","observed":"y","durationMs":10,"timestamp":"2026-07-20T00:00:00.000Z","evidenceId":"path1","evidenceHash":"deadbeef"}]'::jsonb,
    '[{"criterionId":"AC-01","kind":"SCREENSHOT","sha256":"deadbeef","storagePath":"path1","byteSize":10}]'::jsonb,
    'chromium', '0.7.0', 'manifestHash1', now(), now()
  );
  assert v_outcome = 'READY_FOR_REVIEW', 'expected READY_FOR_REVIEW outcome, got ' || v_outcome;
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'READY_FOR_REVIEW', 'record should be READY_FOR_REVIEW after passing completion';
  assert v_record.active_job_id is null, 'active_job_id should clear on completion';
  assert v_record.last_run_id = v_job_id, 'last_run_id should point at the completed job';
  raise notice 'CHECK 3 PASSED: lease + complete transition record to READY_FOR_REVIEW and clear active_job_id';

  -- 4) Completing an already-COMPLETED job again must be a safe no-op (duplicate), not a mutation.
  v_outcome := complete_verification_job_atomic(
    v_job_id, 1, v_lease_id,
    '[{"criterionId":"AC-01","status":"PASS","expected":"x","observed":"y","durationMs":10,"timestamp":"2026-07-20T00:00:00.000Z","evidenceId":"path1","evidenceHash":"deadbeef"}]'::jsonb,
    '[{"criterionId":"AC-01","kind":"SCREENSHOT","sha256":"deadbeef","storagePath":"path1","byteSize":10}]'::jsonb,
    'chromium', '0.7.0', 'manifestHash1', now(), now()
  );
  assert v_outcome = 'DUPLICATE', 'expected DUPLICATE on re-completion, got ' || v_outcome;
  raise notice 'CHECK 4 PASSED: re-completing a COMPLETED job is a safe idempotent no-op';

  -- 5) Create a review packet bound to the current last_run_id + criteria revision.
  v_packet_id := create_review_packet_secure_atomic(
    v_record_id, v_job_id, 'REVIEW-TEST01',
    jsonb_build_object(
      'recordId', v_record_id,
      'run', jsonb_build_object('runId', v_job_id),
      'revision', 1,
      'intendedReviewerEmail', 'reviewer@example.test'
    ),
    'snapHash1', 'bearerHash1', 'accessCodeHash1', 'reviewer@example.test',
    now() + interval '72 hours', 'actorHash1', 1
  );
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'record should be IN_REVIEW after review packet creation';
  raise notice 'CHECK 5 PASSED: create_review_packet_secure_atomic binds recipient, current run, and revision and flips record to IN_REVIEW';

  -- 6) Revoking an older packet cannot reopen a record while another active packet exists.
  insert into review_packets_v2(
    record_id, run_id, public_id, snapshot, snapshot_sha256, bearer_token_hash,
    access_code_hash, intended_reviewer_email, expires_at, criteria_revision
  )
  values (
    v_record_id, v_job_id, 'REVIEW-TEST01-OVERLAP',
    jsonb_build_object(
      'recordId', v_record_id,
      'run', jsonb_build_object('runId', v_job_id),
      'revision', 1,
      'intendedReviewerEmail', 'reviewer@example.test'
    ),
    'snapHashOverlap', 'bearerHashOverlap', 'accessCodeHashOverlap',
    'reviewer@example.test', now() + interval '48 hours', 1
  )
  returning id into v_overlapping_packet_id;
  perform manage_review_packet_atomic(v_packet_id, v_owner, 'revoke', 'actorHash1', now());
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'revoking an older packet must not reopen a record with another active packet';
  assert exists (select 1 from review_packets_v2 where id = v_packet_id and revoked_at is not null), 'revoked packet should retain its revocation timestamp';
  perform manage_review_packet_atomic(v_overlapping_packet_id, v_owner, 'revoke', 'actorHash1', now());
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'READY_FOR_REVIEW', 'revoking the final active packet should restore READY_FOR_REVIEW';

  v_packet_id := create_review_packet_secure_atomic(
    v_record_id, v_job_id, 'REVIEW-TEST01-REPLACEMENT',
    jsonb_build_object(
      'recordId', v_record_id,
      'run', jsonb_build_object('runId', v_job_id),
      'revision', 1,
      'intendedReviewerEmail', 'reviewer@example.test'
    ),
    'snapHash1b', 'bearerHash1b', 'accessCodeHash1b', 'reviewer@example.test',
    now() + interval '72 hours', 'actorHash1', 1
  );
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'IN_REVIEW', 'replacement packet should put the record back IN_REVIEW';
  perform redeem_review_packet_secure_atomic(
    v_packet_id, 'bearerHash1b', 'accessCodeHash1b', 'reviewer@example.test',
    'reviewSessionHash', now() + interval '1 hour', 'reviewerActor', 'snapHash1b', now()
  );
  assert exists(select 1 from review_sessions_v2 where packet_id=v_packet_id and session_hash='reviewSessionHash'), 'review redemption should create the session';
  assert exists(select 1 from transaction_audit_events where record_id=v_record_id and event_type='REVIEW_LINK_REDEEMED'), 'review redemption should append its audit event in the same transaction';
  raise notice 'CHECK 6 PASSED: review replacement and redemption preserve state and append their audit record atomically';

  -- 7) Recipient identity, decision, record state, audit event, and durable
  -- owner notification commit atomically.
  begin
    perform record_review_decision_with_notification_atomic(v_packet_id, 'APPROVED', 'Wrong Reviewer', 'attacker@example.test', 'looks good', '2026-07-20', 'actorHash2', 'US', now(), 'receiptHashWrong', 'IN_APP', 'receiptSessionHashWrong', now() + interval '30 days');
    raise exception 'CHECK 7 FAILED: a non-recipient reviewer email must be rejected';
  exception when others then
    if sqlerrm like 'CHECK 7 FAILED%' then raise; end if;
    assert (select decision is null from review_packets_v2 where id = v_packet_id), 'rejected non-recipient decision must not mutate the packet';
  end;
  perform record_review_decision_with_notification_atomic(v_packet_id, 'APPROVED', 'Reviewer', 'reviewer@example.test', 'looks good', '2026-07-20', 'actorHash2', 'US', now(), 'receiptHash1', 'IN_APP', 'receiptSessionHash1', now() + interval '30 days');
  select * into v_record from transaction_records where id = v_record_id;
  assert v_record.status = 'APPROVED', 'record should be APPROVED after decision';
  assert exists (
    select 1 from operator_notifications
    where owner_user_id = v_owner and record_id = v_record_id and event_type = 'APPROVED'
  ), 'decision transaction should create its durable owner notification';
  assert exists (select 1 from receipt_sessions_v2 where packet_id = v_packet_id and session_hash = 'receiptSessionHash1'), 'decision transaction should create narrow receipt access atomically';
  assert exists (select 1 from review_packets_v2 where id = v_packet_id and legal_terms_accepted and receipt_sha256 = decision_event_hash), 'decision must retain legal acceptance and bind receipt to the decision audit event';
  v_receipt_grant_id := mint_receipt_session_secure_atomic(
    v_packet_id,v_owner,'receiptGrantToken1','receiptGrantCode1','reviewer@example.test',
    now()+interval '30 days','ownerActor'
  );
  assert exists(select 1 from receipt_sessions_v2 where packet_id=v_packet_id and session_hash='receiptSessionHash1' and revoked_at is not null), 'minting a receipt link must revoke the prior browser receipt session';
  assert exists(select 1 from receipt_sessions_v2 where id=v_receipt_grant_id and expires_at>now()+interval '29 days'), 'receipt grants must honor the published 30-day access window';
  perform redeem_receipt_session_secure_atomic(
    v_packet_id,'receiptGrantToken1','receiptGrantCode1','reviewer@example.test',
    'redeemedReceiptSession1',now()+interval '30 days',now()
  );
  v_replacement_receipt_grant_id := mint_receipt_session_secure_atomic(
    v_packet_id,v_owner,'receiptGrantToken2','receiptGrantCode2','reviewer@example.test',
    now()+interval '30 days','ownerActor'
  );
  assert exists(select 1 from receipt_sessions_v2 where id=v_receipt_grant_id and session_hash='redeemedReceiptSession1' and revoked_at is not null), 'a replacement receipt link must revoke an already-redeemed copied session';
  assert exists(select 1 from receipt_sessions_v2 where id=v_replacement_receipt_grant_id and revoked_at is null), 'the replacement receipt grant must remain active';
  begin
    perform record_review_decision_with_notification_atomic(v_packet_id, 'APPROVED', 'Reviewer', 'reviewer@example.test', 'again', '2026-07-20', 'actorHash2', 'US', now(), 'receiptHash2', 'IN_APP', 'receiptSessionHash2', now() + interval '30 days');
    raise exception 'CHECK 7 FAILED: a second decision on the same packet must be rejected';
  exception when others then
    if sqlerrm like 'CHECK 7 FAILED%' then raise; end if;
    raise notice 'CHECK 7 PASSED: atomic decision created the notification and rejected a second decision (%.)', sqlerrm;
  end;

  -- 7b) Invoice planning, test-draft creation, webhook transitions, and connection history are atomic and monotonic.
  perform save_invoice_plan_atomic(v_record_id,v_owner,null,'Client Billing','billing@example.test',14,'Approved milestone',false,1000,'USD',1,repeat('a',64),'ownerActor');
  assert exists(select 1 from transaction_audit_events where record_id=v_record_id and event_type='INVOICE_PLAN_SAVED'), 'saving an invoice plan must append its audit event';
  perform connect_stripe_account_atomic(v_owner,'acct_greenlit',false,'cipher-access','cipher-refresh',now()+interval '1 hour',now());
  assert exists(select 1 from stripe_connection_events where owner_user_id=v_owner and event_type='CONNECTED'), 'Stripe connection history should be durable';
  v_invoice_job := queue_approved_invoice_job_atomic(v_packet_id,v_owner,'ownerActor');
  perform claim_invoice_job_atomic(v_invoice_job.id,v_owner,now());
  perform record_invoice_created_atomic(v_invoice_job.id,'acct_greenlit','cus_greenlit','in_greenlit',1000,'USD','billing@example.test',now()+interval '14 days','','','');
  perform record_invoice_test_draft_atomic(v_invoice_job.id,'',1000,0,'USD',now()+interval '14 days','','',now());
  assert (select status from record_invoices where packet_id=v_packet_id)='DRAFT', 'test mode must finish with a Stripe draft, not an emailed invoice';
  assert exists(select 1 from transaction_audit_events where record_id=v_record_id and event_type='INVOICE_TEST_DRAFT_CREATED'), 'test-draft creation must be audited';
  perform apply_stripe_invoice_event_atomic('evt_paid','acct_greenlit','invoice.paid','in_greenlit',false,repeat('b',64),'paid','INV-1',1000,1000,'USD',now()+interval '14 days','https://invoice.test','https://invoice.test/pdf',now());
  perform apply_stripe_invoice_event_atomic('evt_older_open','acct_greenlit','invoice.updated','in_greenlit',false,repeat('c',64),'open','INV-1',1000,0,'USD',now()+interval '14 days','https://invoice.test','https://invoice.test/pdf',now()-interval '1 hour');
  assert (select status from record_invoices where packet_id=v_packet_id)='PAID', 'an older webhook must not regress a paid invoice';
  assert (select status from stripe_webhook_events where event_id='evt_older_open')='IGNORED', 'older webhook event should be retained as ignored';
  begin
    perform remove_invoice_plan_atomic(v_record_id,v_owner,'ownerActor');
    raise exception 'CHECK 7b FAILED: invoice details must not be removable after a send attempt';
  exception when others then
    if sqlerrm like 'CHECK 7b FAILED%' then raise; end if;
  end;
  assert disconnect_stripe_account_atomic(v_owner,now(),'functional test'), 'connected Stripe account should disconnect';
  assert exists(select 1 from stripe_connection_events where owner_user_id=v_owner and event_type='DISCONNECTED'), 'Stripe disconnection history should be durable';
  raise notice 'CHECK 7b PASSED: invoice and Stripe state transitions are atomic, test-safe, and monotonic';

  -- 8) A stale run cannot be turned into a NEW review after the record has moved past READY_FOR_REVIEW.
  begin
    perform create_review_packet_secure_atomic(
      v_record_id, v_job_id, 'REVIEW-TEST02',
      jsonb_build_object(
        'recordId', v_record_id,
        'run', jsonb_build_object('runId', v_job_id),
        'revision', 1,
        'intendedReviewerEmail', 'reviewer@example.test'
      ),
      'snapHash2', 'bearerHash2', 'accessCodeHash2', 'reviewer@example.test',
      now() + interval '72 hours', 'actorHash1', 1
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
    'sow2.txt', 'srchash2', v_criteria, 'critHash2',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    v_checks, '0.7.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
  );
  v_job2_id := (v_result->>'jobId')::uuid;
  perform lease_verification_job_atomic(v_job2_id,1,v_job2_lease_id);
  perform fail_verification_job_atomic(v_job2_id, 1, v_job2_lease_id, 'synthetic failure', 'VERIFICATION_FAILED');
  select * into v_record from transaction_records where id = (v_result->>'recordId')::uuid;
  assert v_record.status = 'READY', 'record should return to READY after job failure';
  assert v_record.active_job_id is null, 'active_job_id should clear on failure';

  v_retry_result := retry_verification_job_atomic(v_job2_id, 'operator@example.test');
  assert v_retry_result is not null, 'retry should succeed when the record has not changed since the failed job';
  raise notice 'CHECK 9a PASSED: retry succeeds when the record''s criteria revision has not changed';

  -- Fail the retried job too, then bump the record's criteria (new run supersedes it), and confirm retry of the ORIGINAL failed job is now rejected as stale.
  perform lease_verification_job_atomic((v_retry_result->>'jobId')::uuid,1,v_retry_lease_id);
  perform fail_verification_job_atomic((v_retry_result->>'jobId')::uuid, 1, v_retry_lease_id, 'synthetic failure 2', 'VERIFICATION_FAILED');
  v_retry_result := queue_verification_job_atomic(
    (v_result->>'recordId')::uuid, 'MP-TEST02', v_owner, 'hash2', 'IMPORTED_FIXTURE',
    'Agency', 'Client', 'Project2', 'Milestone2', 2000, 'USD',
    'sow2.txt', 'srchash2-changed', v_criteria, 'critHash2-changed',
    'https://example.test', 'https://example.test/fixture/rc1', 'launch-rc1',
    v_checks, '0.7.0', '{}'::jsonb, 'actorHash1', '2026-07-20', '[]'::jsonb
  );
  perform lease_verification_job_atomic((v_retry_result->>'jobId')::uuid,1,v_changed_lease_id);
  perform fail_verification_job_atomic((v_retry_result->>'jobId')::uuid, 1, v_changed_lease_id, 'synthetic failure 3', 'VERIFICATION_FAILED');
  begin
    perform retry_verification_job_atomic(v_job2_id, 'operator@example.test');
    raise exception 'CHECK 9b FAILED: retrying a job whose record has since changed criteria must be rejected';
  exception when others then
    if sqlerrm like 'CHECK 9b FAILED%' then raise; end if;
    raise notice 'CHECK 9b PASSED: retry is rejected once the record''s criteria/source changed since the failed job (%.)', sqlerrm;
  end;

  -- 10) Staged evidence deletion respects both record and artifact holds and remains retryable.
  insert into evidence_artifacts_v2(id, record_id, run_id, criterion_id, kind, storage_path, mime_type, byte_size, sha256, expires_at, legal_hold)
  values (v_evidence_id1, v_record_id, v_job_id, 'AC-HOLD', 'SCREENSHOT', 'held/path.png', 'image/png', 10, 'feedbeef', now() - interval '1 day', true);
  insert into evidence_artifacts_v2(id, record_id, run_id, criterion_id, kind, storage_path, mime_type, byte_size, sha256, expires_at, legal_hold)
  values (v_evidence_id2, v_record_id, v_job_id, 'AC-FREE', 'SCREENSHOT', 'free/path.png', 'image/png', 10, 'cafebabe', now() - interval '1 day', false);

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

  -- 12) Privacy deletion removes only records owned by the requester. A
  -- reviewer match must never delete another agency's legal transaction.
  insert into auth.users(id,email) values(v_privacy_owner,'privacy-owner@example.test'),(v_other_owner,'other-agency@example.test');
  v_result := queue_verification_job_atomic(
    null,'MP-PRIVACY-OWNER',v_privacy_owner,'privacyhash1','IMPORTED_FIXTURE',
    'Privacy Agency','Client','Owned project','Owned milestone',1000,'USD',
    'owned.txt','ownedsource',v_criteria,'ownedcriteria',
    'https://example.test','https://example.test/fixture/rc1','owned-build',
    v_checks,'0.7.0','{}'::jsonb,'actorPrivacy','2026-07-20','[]'::jsonb
  );
  v_owned_record_id := (v_result->>'recordId')::uuid;
  v_result := queue_verification_job_atomic(
    null,'MP-PRIVACY-REVIEWER',v_other_owner,'privacyhash2','IMPORTED_FIXTURE',
    'Other Agency','Client','Reviewed project','Reviewed milestone',1000,'USD',
    'reviewed.txt','reviewedsource',v_criteria,'reviewedcriteria',
    'https://example.test','https://example.test/fixture/rc1','reviewed-build',
    v_checks,'0.7.0','{}'::jsonb,'actorOther','2026-07-20','[]'::jsonb
  );
  v_reviewed_record_id := (v_result->>'recordId')::uuid;
  v_reviewed_job_id := (v_result->>'jobId')::uuid;
  insert into review_packets_v2(record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision,decision,reviewer_name,reviewer_email,intent_confirmed,electronic_records_consent,notice_version,decided_at)
  values(v_reviewed_record_id,v_reviewed_job_id,'REVIEW-PRIVACY-TEST','{}','privacy-snapshot','privacy-bearer',now()+interval '48 hours',1,'APPROVED','Privacy Owner','privacy-owner@example.test',true,true,'2026-07-20',now());
  insert into privacy_requests_v2(id,public_id,request_type,email,status,identity_verified_at)
  values(v_privacy_request_id,'PRIVACY-TEST','DELETION','privacy-owner@example.test','VERIFYING',now());
  v_count := schedule_privacy_deletion_atomic(v_privacy_request_id,'operator@example.test',now());
  assert v_count = 1, 'only the requester-owned record should be scheduled';
  assert (select privacy_deletion_requested_at is not null and retention_until<=now() from transaction_records where id=v_owned_record_id), 'owner record should be due for hold-aware deletion';
  assert (select privacy_deletion_requested_at is null and retention_until>now() from transaction_records where id=v_reviewed_record_id), 'reviewer match must not delete the other agency record';
  assert exists(select 1 from privacy_account_deletions where auth_user_id=v_privacy_owner and status='PENDING'), 'Auth account cleanup should wait until owned records are gone';
  raise notice 'CHECK 12 PASSED: privacy deletion isolates owner records and preserves reviewer-only legal records';

  raise notice '=== ALL FUNCTIONAL CHECKS PASSED ===';
end $$;
