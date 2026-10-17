# Shared Staff Login Implementation Plan

**Goal:** Enable one shared, mailbox-free staff login without exposing administrator permissions.

**Architecture:** The staff page accepts username `staff` and maps it to the internal confirmed Auth identifier `staff-portal@staff.invalid`. Password verification remains Supabase Auth; all data operations remain server-authorized by the `staff` role. Member selection is separate from authentication.

**Tech Stack:** React, Vitest, Supabase Auth, PostgreSQL, Edge Functions, GitHub Pages.

## Tasks

- [ ] Add failing repository tests for username normalization, identifier mapping, and rejection of other identifiers. Update the page test to submit a non-email username. Run the focused tests and observe the expected failures.
- [ ] Implement the mapping in `src/storage/staffRepository.ts`, change the form and three translations, then pass the focused tests. Keep passwords out of localStorage and preserve server role checks.
- [ ] Update `docs/STAFF_PORTAL_SETUP.md` with the fixed internal Auth identifier, manual confirmation requirement, and owner-managed password resets. Run all frontend tests and ordinary/Pages builds.
- [ ] Inspect current main and production migration state. Preserve already deployed visitor changes. Rehearse migrations and authorization/concurrency on an isolated PostgreSQL instance.
- [ ] Obtain an encrypted, restorable production backup and verify it before applying pending migrations. If database access cannot produce a recoverable backup, stop at that actual external blocker rather than changing production unsafely.
- [ ] Deploy migrations/Edge Functions, provision one distinct confirmed `staff` Auth account, and verify full-admin API denial. Store generated credentials only in a private local handoff file, never source control or tool output.
- [ ] Publish the integrated frontend and verify the public page. Report the usable URL or the specific user action needed to unblock remaining work.
