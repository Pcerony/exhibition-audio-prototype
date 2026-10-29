# Visitor Sound Map Implementation Plan

> Execute inline with executing-plans. User approved the 3D design and requested local integration with real data, stopping before production publication. No additional design approval or repeated experience-testing rounds are required.

**Goal:** Integrate the approved mobile-first 3D sound map into the existing visitor app, using actual active cloud recordings and short-lived playback grants, and leave a locally runnable release candidate awaiting publication approval.

**Architecture:** A new read-only `public-map` Edge Function exposes explicitly approved exhibition recordings through a minimal DTO. Existing token-authorized playback remains authoritative. A localhost-only development bridge runs the same catalog handler against the existing cloud data without deploying the function or changing production resources. Three.js is lazy-loaded in an independent visitor screen; recording flow state remains mounted while exploring.

**Tech Stack:** React, TypeScript, Vite, Three.js, proj4, Supabase Edge Functions/Postgres/private Storage. Google place-only recordings retain their original map link rather than importing restricted Places coordinates into a non-Google map.

## Boundaries

- Work on `codex/visitor-sound-map`; preserve all existing uncommitted audio-review, QR, translation and operator changes.
- Historical recordings may be included: the user confirmed permission in this chat. No audio downloads, copies, or database writes are needed for browsing.
- No push, database migration, Edge deployment, DNS, Pages change, or production publication until the user confirms.
- User waived further testing rounds. Perform a production build and read-only integration/authorization checks; record what is not verified rather than claim full acceptance.

## Tasks

- [x] Freeze the API and privacy changes in `docs/API_CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`. Catalog DTO: `{id,token,label,categoryCode,durationSeconds,createdAt,location}`; GET supports UUID tag-ID cursor and bounded pagination; disabled/deleted/unbound records, private paths, drafts and administrative data are excluded.
- [x] Add `supabase/functions/public-map/{handler,index}.ts`, register JWT-free routing with server-side filtering. Keep table RLS unchanged and add no schema migration. Document explicit exhibition-wide discovery as an exception to the former token-only discovery rule.
- [x] Add a server-only localhost development bridge. It obtains the linked project's service credential only in process memory, invokes the same read-only handler, binds to loopback, disallows cross-origin requests, never exposes credentials to Vite/browser code, and has no write endpoint. Production browsers use the deployed Edge Function, never the bridge.
- [x] Package only static model geometry/landmark data in `public/sound-map/`; add geographic projection and westward coverage toward Ohori Park. Never package visitor tokens, recordings or database dumps as public assets.
- [x] Add a dedicated sound-map repository and lazy 3D visitor components. Project user-specified pin coordinates directly. Keep place-only recordings in the accessible list with their original Google Maps link; Places policy prohibits putting those results on an independent non-Google map. Never invent positions. Independent re-marking of the six historical place-only recordings requires separate confirmation.
- [x] Preserve approved model/labels/logo pins, render on demand, dispose GPU resources/listeners, offer list fallback, merge only practically inseparable screen positions, use existing audio player and retry expired grants. A single selected recording controls playback; close/switch stops the prior recording.
- [x] Add recording-before/after entrances and a standalone `#/map` route. Preserve the originating token and draft state. Submission success no longer requires a physical map; physical placement becomes optional. Keep five visitor languages and update disclosure to include online-map publication.
- [x] Build with `npm run build` and `GITHUB_PAGES=true npm run build`; inspect actual cloud counts, location availability, private-field exclusion and one authorized playback grant through read-only calls. Do not create a test recording or change cloud state.
- [x] Start the integrated local app, provide its URL, document backend-first deployment commands and the approval boundary, and stop before publication. Production release remains explicitly unperformed.

## Completion Evidence

The app must build, render the actual catalog locally (not a static snapshot), request a valid current playback grant, preserve the existing recording route and display online-map entrances before/after recording. The new function and assets must be deployable from the repository, with no server secrets or user audio in `dist`. The final handoff states exactly which checks ran and which production actions await approval.
