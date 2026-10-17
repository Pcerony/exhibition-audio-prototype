# Admin Map Piece Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real 73-piece Fukuoka assembly map in the authenticated admin, suggest a piece after a successful visitor claim without ever blocking audio/location submission, and support audited manual correction.

**Architecture:** Pin the exact 73-piece geometry source and derive a versioned coordinate transform from the preview's named station anchors plus the official PLATEAU station dataset. The claim endpoint persists the recording/location first, then attempts piece assignment in a separate best-effort step; map failures cannot change a successful claim, and database rules prevent automatic results replacing manual corrections. Admin list responses carry only assignment metadata; the authenticated UI draws the 73 vector outlines and provides a version-checked manual correction action.

**Tech Stack:** React, TypeScript, GeoJSON, `proj4`, Supabase Edge Functions, PostgreSQL migrations, Deno/PGlite, Vitest.

## Baseline and rollback

- Work only in `codex/admin-transcription-status`, isolated at `/Users/heisei/.codex/worktrees/admin-transcription-status/exhibition-audio-prototype`.
- The verified transcription-list baseline is commit `76da3d9` and annotated tag `checkpoint-admin-transcription-status-2026-10-17`; it is pushed to GitHub and remains deploy-free.
- Before implementation, commit this plan and tag it. After each independently verified map-data, persistence/API, and UI milestone, commit and push the feature branch and create an annotated `checkpoint-admin-map-*` tag. Never reset or force-push shared history.
- Do not query/export production rows, apply migrations to the linked project, deploy Edge Functions, or publish Pages in this plan. Production release needs a separate explicit authorization and backup/recovery review.

## Frozen map inputs and guardrails

- Geometry input: only the `station_priority` layout's 73 polygons from `Pcerony/fukuoka-city-model-preview` commit `a4270a1b2ee0a150997fde0d69fe1ca033e536a9`, not the 8.3 MB page bundle, STL/3MF, or unrelated buildings/roads data. The layout reports 73 pieces and `0 / 0 mm²` gaps/overlaps in its own preview; tests must still check the extracted IDs and valid closed polygon rings.
- Geography anchors: `TENJIN` `[206.62921348314543,948.1789886226901]` and `HAKATA` `[1240.786516853931,853.9689494938127]` in model-local mm. Their candidate WGS84 points are the Tenjin Subway and Hakata JR station features in the PLATEAU 2022 related GeoJSON. Fit a uniform scale/rotation/translation after projecting WGS84 to JGD2011 Japan Plane Rectangular CS II (EPSG:6670); pin the projection definition and all anchor values in a versioned transform module.
- Before enabling automatic suggestions, validate more than the two fitting anchors against independent, named central-Fukuoka station points and inspect their overlay against the source map. Record the check points, expected piece IDs, fitted scale/rotation, boundary tolerance, and decision in `docs/MAP_PIECE_DATA.md`. Since the preview has no additional local-coordinate controls, state explicitly that independent numeric residuals are unavailable; label every successful output as a system estimate, not confirmed physical placement. If the independent piece/order checks disagree with the source map, leave the code unset and deliver the map/manual workflow instead.
- PLATEAU geometry is derived map data, not a current survey of where a visitor physically places a card. Display automatic output as a location-based suggestion, never as proof of the physical card position. Near-boundary, multiple-match, missing-coordinate, or out-of-extent results must remain reviewable.
- Place coordinates are transient: the selected Google Place coordinate may be used only during the current claim/map calculation. Persist the existing `placeId` only; never add returned place coordinates, address, or name to a database row, transcript, log, CSV, or API response. User-selected pin coordinates keep their existing contract.

## Files and ownership

- `src/domain/map-piece-geometry-v13.json`, `src/domain/mapPieces.ts`, and `src/domain/mapPieces.test.ts`: the small, pinned 73-polygon asset, ID/type helpers, and structural/identity checks.
- `src/domain/mapPieceAssignment.ts` and its tests: pinned CRS transform, anchor fit, point-in-polygon classification, explicit boundary tolerance, and candidate result states.
- `docs/MAP_PIECE_DATA.md`, `docs/API_CONTRACT.md`, `docs/README.md`, `docs/STATUS.md`, and `docs/DEVELOPMENT.md`: data provenance, accuracy evidence, assignment contract, phase status, and rollback checkpoints.
- `src/features/visitor/googleMaps.ts`, `VisitorPage.tsx`, `src/storage/repository.ts`, and `supabase/functions/public-upload-claim/handler.ts`: carry a place coordinate only in memory/request for the just-selected place, and attempt assignment only after the successful claim result.
- `supabase/migrations/202610170004_map_piece_assignment.sql`, `supabase/tests/map_piece_assignment.sql`, and `map_piece_assignment_test.ts`: private assignment table, claim initialization, allowed piece/state validation, idempotent automatic update, and manual override/audit transaction.
- `supabase/functions/admin-api/handler.ts`, `handler_test.ts`, `src/storage/adminRepository.ts`, and `cloudAdminRepository.ts`: authenticated assignment summary read and version-checked manual update, without location-provider coordinates or transcript text.
- `src/features/admin/MapPieceMap.tsx`, `CloudAdminPage.tsx`, `CloudAdminPage.test.tsx`, `cloudAdminMessages.ts`, and `cloud-admin.css`: responsive vector overview, selected-piece highlighting/filtering, status labels, and correction flow.

## Task 1: Freeze and validate the 73-piece source

- [x] Write `mapPieces.test.ts` first. Assert map version `fukuoka-road-73-v13`, exactly 73 unique codes, rows A-H with C1-C10 and all other rows 1-9, Polygon geometry with closed rings, and all points finite and within source bounds.
- [x] Run `npm test -- --run src/domain/mapPieces.test.ts` and confirm it fails because the pinned piece module/data do not exist.
- [x] Add only the selected `station_priority.pieces` geometry from the pinned upstream commit. Keep metadata limited to piece code, polygon coordinates, and source/version; do not copy embedded roads/buildings, visitor data, or the full 8 MB HTML.
- [x] Add `docs/MAP_PIECE_DATA.md` with the upstream commit/hash, 73-piece version, units/local origin, model source, PLATEAU/Fukuoka attribution, required modification note, applicable official policy link, and an explicit statement that local-mm geometry is not georeferenced by itself.
- [x] Run the focused geometry test and production build, `git diff --check`, and inspect the generated file size (438,428 bytes) and fields. Stage only geometry/provenance/tests for the milestone commit.

## Task 2: Establish a tested geographic transform and piece classifier

- [x] Add tests for the Tenjin/Hakata anchor projection, exact anchor-to-model fit, several independent central-Fukuoka PLATEAU station/landmark checks, a point inside a known polygon, a point outside the extent, and a point on/near a boundary.
- [x] Run `npm test -- --run src/domain/mapPieceAssignment.test.ts`; confirm missing transform/classifier behavior fails before production implementation.
- [x] Add `proj4` as a pinned runtime dependency, define EPSG:6670 from the official Japan zone-II parameters, and implement a similarity transform from the pinned anchors to local mm. Reject non-finite/out-of-range input; classify one matching piece as a candidate, multiple/near-edge matches as `needs_review`, and points outside all polygons as `outside_map`.
- [x] Independently check the transform against the recorded named points. Do not reuse either fit anchor as an independent check. If piece/order checks disagree with the source map, do not return an automatic piece code; preserve `needs_review` while continuing the admin manual-map workflow.
- [x] Run focused tests and the production build. Record test points, outputs, fitted scale/rotation, 25 m review tolerance, and the qualitative accuracy boundary in `docs/MAP_PIECE_DATA.md`; do not claim numeric independent residuals when extra local-coordinate controls are unavailable. Commit/tag `checkpoint-admin-map-transform-2026-10-17` only after this evidence is reviewed.

## Task 3: Persist assignments with race-safe manual precedence

- [x] Write PGlite SQL tests first for: claim creates `pending` when a location exists and `not_applicable` without one; valid automatic assignment is idempotent; invalid map versions/codes are rejected; `outside_map`/`needs_review` keep no fabricated code; manual update increments version and records old/new/operator/time in `audit_log`; stale version fails; later automatic update cannot replace a manual assignment; deleting/resetting the recording cascades assignment state.
- [x] Run `npx --yes deno@2.9.6 test --node-modules-dir=none --no-lock --allow-read supabase/tests/map_piece_assignment_test.ts` and confirm the missing table/functions fail.
- [x] Add the new migration (never edit an existing migration). RLS and table grants stay service-role-only. Initialize one assignment row transactionally for every newly claimed recording, using existing saved location only to distinguish pending from not-applicable.
- [x] Add service-role-only idempotent automatic assignment RPC and authenticated-operator manual update RPC. The manual RPC checks operator role and expected version, validates the map version/piece code, and writes assignment plus audit entry atomically. Every automatic write uses a conditional update that refuses rows whose source is `manual`.
- [x] Replace `admin_list` in this new migration so the optional `pieceCode` filter is applied to the full filtered set before total count and pagination; preserve every existing search, transcription, date, state, and ordering rule.
- [x] Run the focused PGlite migration tests and existing backend suite. Commit/tag `checkpoint-admin-map-persistence-2026-10-17` after review of the complete migration diff.

## Task 4: Compute after claim without making claim depend on maps

- [x] Add a failing cloud repository/Edge test in which geometry/classification or assignment persistence fails after `claim_recording_transcription` succeeds; assert the API still returns `claimed`, the recording/location claim remains committed, and the assignment stays `pending` or `needs_review`.
- [x] Extend place selection callback to expose the selected `place.location` only in memory alongside the existing `placeId`; pin selections use their existing lat/lng. Add the transient point to the upload-claim request only, and assert the persisted location/claim RPC receives exactly the existing parsed `MemoryLocation` shape.
- [x] In `public-upload-claim`, complete upload validation and `claim_recording_transcription` first. Only after it reports `claimed`, attempt classification and call the independent automatic assignment RPC; catch/sanitize failures so they cannot change the successful claim response. Invalid/missing optional mapPoint input means `needs_review`, not a rejected claim. Never run assignment for `already-bound`; never send map coordinates to SQL/logs; only piece code, state, and map version may be persisted.
- [x] Task 2 gate permits only a clearly labeled location-based candidate after qualitative independent station/order checks; the output is not a claim about physical placement. No unsupported scale/centroid shortcut was used.
- [x] Run focused claim tests, visitor tests, backend suite, and both builds. Failure-isolation is covered; `checkpoint-admin-map-claim-2026-10-17` preserves this phase.

## Task 5: Add authenticated map summaries and correction API

- [x] Add handler/repository tests for status-only map summaries, selection validation, authenticated manual writes, stale versions, and audit metadata. Assert payloads contain no transcript body or Places/provider metadata.
- [x] Extend `admin-api` list enrichment and authenticated manual update with verified operator identity and stable errors.
- [x] Extend recording/query/repository types with assignment summary and piece filter; preserve server-side filtering, pagination and CSV fields.
- [x] Run focused Deno/PGlite/repository tests and backend suite; see final integrated milestone tag `checkpoint-admin-map-piece-assignment-2026-10-17`.

## Task 6: Build the operator map and manual correction workflow

- [x] Add UI tests for all 73 visible piece labels, row-to-piece highlight, piece-to-list filter, assignment states/source and versioned manual save. List/CSV do not expose location points or transcript text.
- [x] Implement `MapPieceMap` using the actual 73 polygons, piece filtering and record highlighting; label automated output as an estimate.
- [x] Add accessible manual selection, explicit `outside_map` / `needs_review`, optimistic version check, conflict reload and audit/list refresh.
- [x] Add Japanese and Simplified Chinese labels; keep narrow-screen map internally scrollable and CSV schema unchanged.
- [x] Run focused tests and UI inspection at 390px, 768px, and 1280px; included in final integrated milestone tag.

## Task 7: Sync documents and verify the complete branch

- [x] Update API, README, status, development, roadmap, verification and design/plan documents with contract, accuracy boundary, provenance, rollback tag and not-deployed status.
- [x] Run full frontend/backend suites and both builds; inspect migration/Edge/UI diffs and stage no production data, PII, keys, `.env`, backup, `.DS_Store` or screenshots.
- [x] Commit and push the verified candidate with annotated tag `checkpoint-admin-map-piece-assignment-2026-10-17`. Keep the branch unmerged and do not apply/deploy production migrations or publish Pages without separate user authorization.

## Known validation boundary

The public preview has exact plate contours in local millimeters, an assembly layout, and only two named station anchor points. Its printed audit is strong evidence for manufacturing geometry, not a precision survey for Google coordinates. The chosen transform may support a clearly labeled approximate suggestion only after the independent station-piece/order checks and overlay are recorded; the UI must never describe a computed piece as confirmed physical placement.
