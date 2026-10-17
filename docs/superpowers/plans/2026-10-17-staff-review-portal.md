# Staff Review Portal Implementation Plan

**Goal:** Deliver the shared-login, named-staff review website requested by the user.

**Architecture:** A separate React staff route reuses the existing map and audio UI. A dedicated Edge Function verifies JWTs and invokes a private SQL API that limits staff capabilities, paginates authorized draft text, and atomically audits versioned review changes. Existing admin and visitor endpoints retain their permissions.

**Tech Stack:** React/TypeScript, Supabase Auth/Postgres/Edge Functions, Vitest, Deno/PGlite.

## Tasks

Local implementation and verification completed. Production deployment, shared Auth account creation, allowed-origin Google Maps and real-device acceptance remain explicitly outside the completed local checks; see `docs/STAFF_PORTAL_SETUP.md` and `docs/VERIFICATION.md`.

- [x] Freeze `docs/API_CONTRACT.md` and staff DTOs before callers. Implement in isolated `codex/staff-review-portal`, based on the existing map candidate; preserve the primary checkout's unrelated modifications.
- [x] Write failing SQL tests in `supabase/tests/staff_portal.sql` with a PGlite migration harness. Cover staff role, eight-member roster, no privileged table/RPC access, newest recording ordering, global search/filter/pagination, draft body authorized only here, version conflicts, disabled/reset records and atomic audit snapshots. Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/tests/staff_portal_test.ts`.
- [x] Implement `202610170005_staff_portal.sql`: staff role constraint, private roster, private `staff_action` with exactly session/list/history/playback/activity/save actions. Save locks tag then transcription and revokes AI leases. Require current version, consent and a valid selected member; use service timestamps and audit metadata without text.
- [x] Write failing Edge tests for missing/forged JWT, missing role, rejected admin actions, verified user identity, signed playback without path leakage, stable version errors. Implement `staff-api/handler.ts` and `index.ts`, configure JWT verification inside the handler. Add explicit regression denying staff at `admin-api`.
- [x] Write failing repository tests for scoped session/member persistence, auth recovery, narrow payloads and errors. Implement `src/storage/staffRepository.ts` with a separate Supabase browser storage key and typed limited API.
- [x] Write failing `StaffPage.test.tsx` cases for shared login, remember/switch member, inline draft text, JST recording time, search/filter/page requests, review and approval, conflict preservation, map/history, signed playback and no admin buttons. Implement `src/features/staff/StaffPage.tsx`, review/detail components, localized messages and responsive stylesheet. Reuse `MapPieceMap`, `MemoryLocationMap` and the visitor audio player. Auto-refresh must not discard an edit.
- [x] Add `#/staff`/`/staff` routing with test coverage; lazy-load portal. Keep production fail-closed without Supabase configuration, no fallback to local data.
- [x] Run `npm test -- --run`, `npm run test:backend`, `npm run build`, `GITHUB_PAGES=true npm run build`, and `git diff --check`. Apply all migrations to a fresh isolated database as a migration rehearsal. Check mobile/desktop UI using synthetic API fixtures; no production credentials/audio.
- [x] Update API/security/architecture/status and account setup documentation. Leave an accessible local dev server and give the staff URL. Report production/account/real-device verification limits clearly without another design approval request.
