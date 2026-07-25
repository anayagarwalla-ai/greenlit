# Backup, restore, and legacy-source runbook

Greenlit's retained records live in Postgres and its screenshots live in the private `evidence` bucket. Both must be backed up together. The scripts below stage data only in a randomly named system-temporary directory, create one GPG-encrypted archive, and remove the plaintext staging files.

## Encrypted backup

1. Install/import the adult operator's GPG public key and choose an encrypted off-site destination that is not the production Supabase project.
2. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPECTED_SUPABASE_HOST`, `BACKUP_OUTPUT_DIR`, and `BACKUP_ENCRYPTION_RECIPIENT` in the local shell. Do not put their values in a committed file. The script converts the database URL into a temporary mode-0600 PostgreSQL password file so credentials never appear in a child process command line.
3. Run `pnpm ops:backup`.
4. Move the resulting `.tar.gz.gpg` file to the restricted off-site destination and record the filename, operator, date, and destination in the private operations log.

The manifest contains no source text, but the database dump and screenshots contain confidential business records. Restrict access and retain the archive according to the same legal-hold and retention decisions as production.

## Isolated restore test

1. Create a new empty Postgres database whose name contains `restore`, `test`, or `scratch`. Never point the script at production.
2. Set `RESTORE_DATABASE_URL` and `BACKUP_FILE` (or pass the encrypted backup path as the first argument). Restore clients also use a temporary mode-0600 password file rather than receiving the URL in their command line.
3. Run `pnpm ops:restore-check`.

The verifier refuses a non-empty database, validates the database-dump and every evidence-file hash, restores the database, and reports the restored record count and latest audit head. Inspect one restored transaction, its audit chain, and the matching screenshot hash before signing off the backup.

## Legacy source-document inventory and purge

Old releases created a `source_documents` table and private `source-documents` bucket. Current Greenlit does not use either. Run `pnpm ops:legacy-sources` first; it produces a metadata-only inventory in `docs/operations/` and never prints source text.

After the adult operator verifies `EXPECTED_SUPABASE_HOST`, has a current encrypted backup, and approves deletion, set `PURGE_LEGACY_SOURCE_DATA=YES` and run:

```sh
pnpm ops:legacy-sources -- --purge
```

The purge removes bucket objects before rows and writes a dated local deletion report. Store that report in the restricted operations log; do not commit it if filenames expose client information.
