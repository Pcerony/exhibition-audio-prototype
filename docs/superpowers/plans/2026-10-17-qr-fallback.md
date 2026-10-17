# QR Fallback Implementation Plan

> **For agentic workers:** Execute task-by-task in this branch. Keep unrelated pre-existing worktree changes untouched.

**Goal:** Add a usable QR-only visitor-entry flow inside the existing operator console without changing the NFC visitor or writer flows.

**Architecture:** Add a server-created tag identity marked `entry_channel='qr'`, persist idempotent QR-issuance requests, and omit it from the generic provisioning-job pool. Add a QR subroute to the existing admin app that reuses current auth and repository interfaces, then render the returned stable visitor URL with a QR library.

**Tech Stack:** React, TypeScript, Vite, Vitest, Supabase Edge Function, PostgreSQL migration, qrcode.react.

---

## File Map

- Create `supabase/migrations/202610170007_qr_fallback.sql`: `entry_channel`, tag DTO extension, and an idempotent `createQrEntry` branch wrapping the existing admin RPC. The release worktree starts from current main, where migrations 003-006 are present and match production.
- Create `supabase/tests/qr_fallback_test.ts` and `supabase/tests/postgres_qr_fallback.mjs`: authorization, idempotency, stable URL, audit, independent-session concurrency, and writer-pool exclusion.
- Modify `supabase/functions/admin-api/handler.ts` and `handler_test.ts`: allow and validate `createQrEntry`, map request-key conflicts.
- Modify `src/storage/adminRepository.ts`, `cloudAdminRepository.ts`, and repository tests: add `createQrEntry(requestKey)`.
- Modify `src/App.tsx` and `src/App.test.tsx`: resolve `#/admin/qr` while preserving existing `#/admin` and visitor routes.
- Create `src/features/admin/QrFallbackPage.tsx`, its focused CSS and tests; modify `CloudAdminPage.tsx` to expose a link and pass the existing repository/auth state into the route.
- Modify `src/storage/cloudAdminRepository.test.ts`, `src/features/admin/CloudAdminPage.test.tsx`, and `docs/API_CONTRACT.md`; add the new spec link to `docs/README.md` only if that file's current pending edits can be preserved without conflict.
- Update `package.json` and lockfile with `qrcode.react` only if the dependency is absent.

## Task 1: Create QR Identities Transactionally

**Files:** migration and SQL/backend tests listed above.

- [x] Add failing-then-passing PGlite assertions and an independent-session PostgreSQL test for same-ID/URL replay, a single tag/audit row, QR-only DTO state, provisioning exclusion, and key conflicts.
- [x] Implement `entry_channel` with default/backfill `nfc`; preserve existing rows and tag uniqueness.
- [x] Wrap the current `admin_action` RPC, intercept only `createQrEntry`, and delegate other actions unchanged.
- [x] In one transaction, persist the `management_requests` key/body, create one unbound QR tag with a non-reused inventory label, add label history, audit `qr_issue`, and store the response for retries.
- [x] Revoke direct execution of the renamed inner RPC and expose only the new wrapper to `service_role`.
- [x] Verify ordinary `prepareWrite` remains unchanged in the migration integration test.

## Task 2: Expose the Contract Through the Existing Cloud Repository

**Files:** `supabase/functions/admin-api/handler.ts`, handler tests, `src/storage/adminRepository.ts`, cloud repository and tests.

- [x] Add failing-then-passing handler coverage for authenticated `createQrEntry` and invalid UUID rejection.
- [x] Add failing-then-passing repository coverage for the request body/response shape.
- [x] Add the action to the allowlist; keep the existing `operator/admin` profile guard and map `REQUEST_KEY_CONFLICT` to HTTP 409.
- [x] Add the repository shape:

```ts
export type QrEntry = { id: string; label: string; visitorUrl: string; entryChannel: 'qr' };
createQrEntry(requestKey: string): Promise<QrEntry>;
```

- [x] Implement the cloud method as `request<QrEntry>('createQrEntry', { requestKey })`.
- [x] Run focused Deno and Vitest tests plus the full backend suite.

## Task 3: Add the Isolated Admin QR Subpage

**Files:** `src/App.tsx`, `src/App.test.tsx`, `CloudAdminPage.tsx`, new QR component/CSS/tests, translations, package manifest/lockfile.

- [x] Add a route test for `#/admin/qr` with regression assertions for `#/admin`, `#/t/<token>`, and `#/preview`.
- [x] Add page tests proving it starts without a QR, retries uncertain requests with the same request key, restores across reload, fails closed if it cannot persist the key, and creates a new key only after an explicit next-participant action.
- [x] Add `qrcode.react`; render the server-returned visitor URL as a high-contrast, error-correction-M QR.
- [x] Reuse the existing repository auth/session and language switch. No new role or profile authorization model.
- [x] Add the QR subroute and existing-dashboard link. The QR route does not load the admin tag list, audio, audit, or write-job data.
- [x] Build a mobile-first QR screen with a single primary command, stable QR dimensions, loading/error states, and explicit next-participant transition.
- [x] Add Japanese and Simplified Chinese staff strings.
- [x] Run the focused and full frontend test suites; existing admin behavior remains covered by tests.

## Task 4: Update the Cross-Client Contract and Verify Release Artifacts

**Files:** `docs/API_CONTRACT.md`, `docs/README.md`, optionally `docs/VERIFICATION.md` after actual verification.

- [x] Document `createQrEntry`, `entryChannel`, request-key replay/conflict behavior, QR-only provisioning exclusion, and the deferred one-card explicit binding rule.
- [x] Preserve pre-existing documentation edits; only insert the QR contract/spec references.
- [x] Run frontend tests, normal build, GitHub Pages build, and backend tests.
- [x] Run PGlite authorization/idempotency coverage and independent-session PostgreSQL concurrency checks. The linked production migration list matches local versions 001-006; only QR migration 007 is pending, and `db push --dry-run` lists only 007.
- [x] Create a fresh AES-256-GCM encrypted single-snapshot production dump for `public`, `auth`, `storage`, and `supabase_migrations`; authenticate-decrypt and restore it into isolated PostgreSQL, matching 38 tags, 20 recordings, 20 transcripts, 2 Auth users, 20 Storage objects, and latest migration 006.
- [x] Capture a protected release metadata snapshot and execute migration 007 in a production transaction rollback rehearsal; existing tag identities, recording rows, and provisioning URLs remain unchanged.
- [x] Start the local dev server and verify the QR route renders the existing staff login. QR generation itself is covered by component tests; no real staff credentials were used.
- [x] Apply migration 007, deploy the compatible `admin-api`, and publish the frontend only after code review and final pre-deployment checks. Production migration 007 and `admin-api` were deployed; PR #21 merged and GitHub Pages run 39041369533 succeeded. The production QR route was checked without using staff credentials or creating QR data.
