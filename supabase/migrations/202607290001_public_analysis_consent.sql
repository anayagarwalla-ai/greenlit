-- Permit non-retained public SOW analysis while preserving the same
-- fail-closed consent ledger used by account-backed imports. Anonymous
-- entries have no account owner and remain attributable only through the
-- keyed, one-way actor hash already used for abuse prevention.

alter table public.analysis_consent_events
  alter column owner_user_id drop not null;

create index if not exists analysis_consent_events_actor_idx
  on public.analysis_consent_events(actor_hash,created_at desc)
  where owner_user_id is null;
