# Admin Transcription Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated operators see and filter transcription consent/progress in the recording list without exposing transcript text in list responses or CSV exports.

**Architecture:** Extend the authenticated admin list contract with a minimal transcription summary and a validated status filter. A dedicated service-role database listing function preserves global filtering, sorting, and pagination; the Edge Function enriches each page with location and status-only fields. The React list renders localized status text while the existing transcription dialog remains the only way to read or edit text.

**Tech Stack:** React, TypeScript, Supabase Edge Functions, PostgreSQL migrations, Deno/PGlite tests, Vitest.

---

## Files and ownership

- `docs/API_CONTRACT.md`: document the list-only status summary, filter values, and privacy boundary before changing callers.
- `src/storage/adminRepository.ts`: define `AdminTranscriptionSummary`, status filter values, and extend `ManagedTag.recording` / `TagQuery`.
- `supabase/migrations/202610170003_admin_list_api.sql`: add a service-role-only `admin_list(p_operator uuid, p_body jsonb)` that validates operator and list inputs, applies the existing list filters plus the global transcription status filter, then returns paginated `tag_dto` rows and total count. This stable list RPC can be extended by the follow-on map-piece feature.
- `supabase/tests/admin_list.sql` and `supabase/tests/admin_list_test.ts`: cover consent, every visible status, filtering across pages, and exclusion of transcript text.
- `supabase/functions/admin-api/handler.ts` and `handler_test.ts`: route authenticated `list` to the new RPC and batch-enrich recording locations and status-only summaries.
- `src/features/admin/CloudAdminPage.tsx`, `CloudAdminPage.test.tsx`, and `cloud-admin.css`: render a localized status column/filter without changing the existing transcription dialog or export fields.
- `src/features/admin/cloudAdminMessages.ts`: add Japanese and Simplified Chinese labels for all filter/status values.
- `docs/README.md`: index the feature plan/spec without adding live event data.

## Task 1: Freeze the list contract

- [x] Add to `docs/API_CONTRACT.md` that admin `list` accepts `transcriptionState?: 'not_consented'|'pending'|'processing'|'draft'|'published'|'failed'`; a recording DTO may contain `transcriptionSummary: {consented:boolean,status:'pending'|'processing'|'ready'|'failed'|null,published:boolean}`; no `text`, `errorCode`, provider error, or location coordinates beyond the existing pin contract are added. `draft` means `ready && !published`; `published` means `ready && published`; absent task with consent is displayed as pending; no consent takes precedence over queue state. `REQUEST_INVALID` from list validation maps to HTTP 400.
- [x] Add `AdminTranscriptionSummary` and the exact string unions to `src/storage/adminRepository.ts`; define `ManagedRecording = NonNullable<Tag['recording']> & { transcriptionSummary?: AdminTranscriptionSummary }`, make `ManagedTag` use `ManagedRecording | null`, and add the optional filter to `TagQuery`.
- [x] Run `npm test -- --run`; expected: all 149 existing tests remain green and the new type-only contract compiles.
- [x] Commit only the feature contract/type/index docs as `docs: define admin transcription list summary`.

## Task 2: Add a private, globally filtered list RPC

- [x] Write SQL integration cases in `supabase/tests/admin_list.sql` for one unconsented recording, pending, processing, ready draft, published ready, failed, an unbound tag, and at least two pages; assert each state filter returns the correct global count and paged rows. Use the existing PGlite migration harness in `supabase/tests/transcription_test.ts` and wrap the fixtures/assertions in `do $$ ... $$;` as in `supabase/tests/transcription.sql`.
- [x] Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/tests/admin_list_test.ts`; first confirmed failure was missing `admin_list(uuid,jsonb)`.
- [x] Add `admin_list(p_operator uuid,p_body jsonb)` in `supabase/migrations/202610170003_admin_list_api.sql`. It validates existing list fields, filters consent/status before counting and paging, preserves ordering and `public.tag_dto(tag)`, and rejects invalid status values with `REQUEST_INVALID`.
- [x] Revoke execution from `public`, `anon`, and `authenticated`; grant only to `service_role`. Keep table RLS unchanged and never include transcription text in this function's JSON.
- [x] Load every migration through the new migration in the PGlite test, execute `supabase/tests/admin_list.sql`, and assert the text sentinel never appears; consent/status/page/privacy assertions pass.
- [x] Add the test to `npm run test:backend`; all 34 backend tests pass.

## Task 3: Enrich authenticated list pages without text

- [ ] Add a failing `handler_test.ts` case whose list RPC returns one recording and whose mocked `recording_transcriptions` row contains `{recording_id:id,status:'ready',published:false,text:'private-sentinel'}`; assert the response's `recording.transcriptionSummary` equals `{consented:true,status:'ready',published:false}`, and that `JSON.stringify(body)` contains neither `private-sentinel` nor `errorCode`.
- [ ] Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/functions/admin-api/handler_test.ts`; expected: the new test fails because the handler still calls `admin_action` and does not return the summary.
- [ ] Update `handler.ts` to validate `transcriptionState` against the six exact values, call `admin_list` for list requests with `{p_operator: verifiedUserId, p_body: body}`, retain location enrichment, fetch only `recording_id,status,published` from `recording_transcriptions`, fetch consent from the existing recordings query, and attach the minimal summary by recording ID. Add `REQUEST_INVALID: 400` to the stable RPC error mapping.
- [ ] Extend the handler fixture to model both batch queries and verify invalid filter values fail before RPC. RPC failures must continue mapping to stable error codes without leaking database details.
- [ ] Run the focused handler tests; expected: all list, privacy, auth, validation, and existing admin action tests pass.
- [ ] Commit the handler and tests as `feat: return admin transcription status summaries`.

## Task 4: Render and filter status in the admin list

- [ ] Add a failing `CloudAdminPage.test.tsx` case that renders six fixtures with `{consented:false,status:null,published:false}`, pending, processing, ready unpublished, ready published, and failed summaries; assert the visible Chinese labels, no transcript body, the existing text button still opens the dialog, and selecting `draft` calls `listTags` with `{transcriptionState:'draft'}`.
- [ ] Run `npm test -- --run src/features/admin/CloudAdminPage.test.tsx`; expected: the new UI assertions fail before implementation.
- [ ] Add localized Chinese/Japanese labels and a status column/filter to `CloudAdminPage.tsx`; carry the selected filter through the existing list effect, reset offset on change, and leave the CSV field list unchanged.
- [ ] Add compact status styles in `cloud-admin.css`; do not introduce nested cards or status-only color distinctions without visible text.
- [ ] Run the focused Vitest suite; expected: all six status cases and existing admin workflows pass.
- [ ] Commit UI, messages, CSS, and tests as `feat: show transcription progress in admin list`.

## Task 5: Sync docs and verify the checkpoint

- [ ] Update `docs/API_CONTRACT.md` with the actual `admin_list` RPC ownership, filter semantics, and no-text response guarantee; add the spec/plan link in `docs/README.md`.
- [ ] Run `npm test -- --run`, `npm run test:backend`, `npm run build`, and `GITHUB_PAGES=true npm run build`; expected: all commands exit 0.
- [ ] Inspect `git diff --check`, the full staged diff, and all files for credentials, audio, PII, exports, `.DS_Store`, or operational backup paths; none may be staged. Stage only the listed feature paths from the clean feature worktree.
- [ ] Commit the feature-specific docs changes as `docs: document admin transcription status list`.
- [ ] Push the feature branch and create/push an annotated milestone tag `checkpoint-admin-transcription-status-2026-10-17` only after the preceding verification succeeds; do not merge to `main` or deploy production migrations.

## Map-piece follow-on gate

The 73-piece locator remains a separate implementation plan because it needs geometry work and a separate operational correction workflow. The provided preview encodes plate geometry in local millimeters and is not itself a georeferenced source. Do not implement or enable automatic point-in-polygon assignment until a versioned 73-piece dataset has a documented CRS/transform, passes no-gap/no-overlap and known-point checks, and has a licensing/policy review. The audio/location claim must remain successful before any best-effort assignment attempt; failed or late automation must never block submission or overwrite a manual assignment. Manual correction requires an authenticated, version-checked atomic update with operator/time audit.
