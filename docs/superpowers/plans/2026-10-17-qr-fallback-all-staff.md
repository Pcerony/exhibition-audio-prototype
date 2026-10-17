# QR Fallback for All Staff Implementation Plan

> **For agentic workers:** Execute task-by-task in this branch. Preserve the already released `#/admin/qr` route and the original workspace's uncommitted changes.

**Goal:** Make the existing QR-only page available from the staff website so every signed-in staff member can create a QR visitor entry without navigating the full operator console.

**Architecture:** Keep the existing operator route and add `#/staff/qr`, backed by the existing staff login and staff website. The page has one workflow: create and show a QR code. The existing staff API carries that action to the same transactional QR issuer so request-key replay, audit, tag identity, and NFC writer exclusion remain identical. This adds no account or role model.

**Tech Stack:** React, TypeScript, Vitest, Supabase Edge Functions, PostgreSQL migration, Deno/PGlite, existing `qrcode.react` page.

## File Map

- Modify `supabase/functions/staff-api/handler.ts` and `handler_test.ts` to allow and validate only the narrow QR issuance action.
- Create `supabase/migrations/202610170008_staff_qr_fallback.sql` to share the QR issuance transaction across `admin_action` and `staff_action` while preserving their existing role gates and service-role-only execution.
- Modify `supabase/tests/qr_fallback_test.ts` and `supabase/tests/postgres_qr_fallback.mjs` to cover staff issuance, replay across entry points, role boundaries, audit, and writer-pool exclusion under PostgreSQL.
- Modify `src/storage/staffRepository.ts` and its tests to expose `createQrEntry(requestKey)` over authenticated `staff-api`.
- Modify `src/App.tsx`, `src/App.test.tsx`, `src/features/staff/StaffPage.tsx`, and staff tests to route `#/staff/qr` and link to it only from the authenticated staff area.
- Reuse `src/features/admin/QrFallbackPage.tsx` from a small `src/features/staff/StaffQrEntry.tsx` adapter; retain the admin login and route unchanged.
- Update `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `docs/SECURITY_PRIVACY.md`, `docs/STATUS.md`, `docs/VERIFICATION.md`, `docs/ROADMAP.md`, and `docs/README.md` after release.

## Task 1: Expose QR Issuance Through Staff API

- [x] Add failing handler tests for an authenticated `staff` `createQrEntry` request, malformed UUID rejection before RPC, unauthenticated rejection, and conflict mapping.
- [x] Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/functions/staff-api/handler_test.ts`; confirm the new allowlist case fails because the action is not accepted.
- [x] Add `createQrEntry` to the staff API allowlist, forward only `requestKey`, validate its UUID, and map `REQUEST_KEY_CONFLICT` to HTTP 409.
- [x] Add repository tests and `StaffRepository.createQrEntry(requestKey)` using the existing session-aware staff request path.
- [x] Run focused Deno and Vitest tests; confirm staff role works and the page remains limited to QR creation.

## Task 2: Share the Transactional QR Issuer

- [x] Extend PGlite assertions first: a `staff` identity can create one QR tag through `staff_action`; replays preserve the same URL and audit; `admin_action` still rejects that `staff` identity; malformed/changed requests fail; no provisioning job is created.
- [x] Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/tests/qr_fallback_test.ts`; verify the new staff assertions fail before migration 008 exists.
- [x] Add migration 008's shared QR transaction core. Preserve current `admin_action` operator/admin checks, current `staff_action` language/list/save/playback behavior, service-role-only wrapper grants, identical advisory-lock key, inventory label history, and `qr_issue` audit.
- [x] Extend independent-session PostgreSQL coverage so staff and operator paths replay the same request key to one identity; retain unique-key concurrency and NFC pool assertions.
- [x] Run focused Deno and PostgreSQL tests, then `npm run test:backend`.

## Task 3: Add the Isolated Staff QR Route

- [x] Add failing route and staff-page tests for `#/staff/qr`, the authenticated QR entry link, and the staff login mode creating a QR without selecting a review-member identity.
- [x] Add lazy `StaffQrEntry` using the existing `StaffRepository`; generalize the QR page only enough to select the existing staff username/password login and return to `#/staff`.
- [x] Preserve `#/admin/qr`, its email login, the staff review route, and all visitor/NFC routes.
- [x] Run focused Vitest suites for `App`, `StaffPage`, `QrFallbackPage`, and `staffRepository`.

## Task 4: Verify and Publish

- [x] Update the cross-client API/security documentation to state that the staff QR page is a single-purpose interface using the existing account and site; no new role model is introduced.
- [x] Run `npm test -- --run`, `npm run test:backend`, the independent PostgreSQL QR test, `npm run build`, `GITHUB_PAGES=true npm run build`, and `git diff --check`.
- [x] Create a fresh encrypted production backup, confirm the remote migration dry-run lists only migration 008, then apply migration 008 and deploy `staff-api`.
- [x] Verify migration state and QR authorization without creating an untracked production QR entry; merge after review to publish Pages.
- [x] Verify `#/staff/qr` reaches the staff-login/QR screen while `#/staff`, `#/admin/qr`, visitor routes, and existing NFC writing remain unchanged.
