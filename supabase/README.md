# Backend Validation

The operator API verifies Auth access tokens with `getUser`, then queries the
`operator_profiles` allowlist. Authenticated users without a supported role are
not operators. Direct privileged RPC/table access is revoked for both anonymous
and authenticated client roles. Do not distribute the service-role key.

Run from the repository root:

```sh
npx -y deno test --no-lock supabase/functions/admin-api/handler_test.ts supabase/functions/_shared/maintenance_test.ts
npx -y deno test --no-lock --node-modules-dir=auto --allow-read --allow-env supabase/tests/local_database_test.ts
npx -y deno test --no-lock --node-modules-dir=auto --allow-read supabase/tests/classification_v3_test.ts supabase/functions/public-upload-claim/handler_test.ts
EMBEDDED_PG_RUNTIME=/tmp/exhibition-pg-runtime node supabase/tests/postgres_classification_v3.mjs
node --test supabase/tests/backend.test.mjs
npx -y deno check --no-lock supabase/functions/admin-api/index.ts supabase/functions/maintenance/index.ts supabase/functions/public-upload-init/index.ts supabase/functions/public-upload-claim/index.ts
```

The embedded PGlite test executes all migrations and the rollback-wrapped SQL
contract tests. Its Auth/Storage schemas and crypto routines are test substitutes;
it does not prove live Supabase RLS/Storage behavior or multi-connection races.
Run `tests/operator_management.sql` against an isolated migrated PostgreSQL
database to exercise real pgcrypto and role privileges. All fictional fixtures
are rolled back. A Docker-based local Supabase environment and independent
concurrent clients are still required for full local integration coverage.

## Cleanup

Failed finalization permanently invalidates a session and durably queues its
immutable object path. Cleanup waits until the preserved signed-upload deadline
expires, so a still-valid Storage token cannot recreate an acknowledged orphan.
Reset locks the tag, invalidates all old sessions, queues objects, deletes the
recording, and audits in one transaction. Claim and initialization use the same
tag-first lock ordering. Failed Storage removals leave queue rows for retry.

`POST /functions/v1/maintenance` requires the high-entropy secret header
`x-maintenance-secret` matching the Edge secret `MAINTENANCE_SECRET`. Missing
configuration fails closed. The authenticated operator API also exposes
`action: maintenance`. Each invocation handles at most 100 object removals.
`maintenance-cron.sql` is opt-in operator setup using pg_cron, pg_net, and Vault;
it is not a migration and contains no production credentials.

Vault names: `exhibition_maintenance_secret`, `exhibition_project_url`,
`exhibition_public_key`. The production 15-minute job is configured and pg_net
returned HTTP 200. See `docs/VERIFICATION.md` for live synthetic tests and physical
device acceptance still required. Run Android builds outside cloud-sync folders
if the provider evicts freshly generated files.

Existing tags are backfilled with pending provisioning jobs. The normalized-label
unique index intentionally rejects legacy duplicate labels; check and resolve
them before applying this migration to a nonempty project. Batch responses are
persisted snapshots: replay returns identical DTOs even after later tag changes.

## Post-Recording Classification V3

`202610160001_post_recording_classification.sql` retains legacy category rows and
recorded labels without assigning them a guessed topic. Four canonical UUIDs live
in `memory_topics`; tag DTO `categoryId` refers to `topic_id`, not the legacy
`category_id`. Empty legacy cards become unclassified inventory cards, with all
former labels retained in history. Every tag keeps its original ID, public token,
and written URL. The internal inventory sequence and daily topic counters are
never reset or decremented, including during synthetic fixture cleanup.

The V3 claim RPC sets the recording timestamp at successful finalization and uses
that exact instant's Asia/Tokyo date for numbering. Only the winning claim allocates
a number. Reset restores the inventory label; correction of a bound card allocates
a target-topic number on the original recording date. Legacy claim/admin entry
points are not callable by client roles or service-role REST callers.

The new real PostgreSQL script uses independent sessions in a disposable local
process. Its runtime prefix must contain `embedded-postgres` and `pg`; it cannot
accept a remote connection string. The opt-in cloud script uses protocol 3, cleans
only its fixture IDs/paths, preserves fixed topic rows/counters, and never invokes
the production-wide maintenance worker. Neither test replaces physical NFC or
two-phone acceptance.
