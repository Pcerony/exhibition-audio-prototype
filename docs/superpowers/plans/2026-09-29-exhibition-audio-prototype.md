# Exhibition Audio NFC Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a runnable Chinese-language web prototype for testing NFC-linked visitor recording/playback and operator management flows.

**Architecture:** Build a mobile-first React/Vite single-page app with `/t/:token` visitor routes and an operator console. Persist tag metadata in localStorage and audio Blobs in IndexedDB to simulate first-writer-wins binding in one browser; keep storage behind a small repository module so Supabase can replace it later.

**Tech Stack:** TypeScript, React, Vite, Vitest, Testing Library, browser MediaRecorder, IndexedDB.

---

### Task 1: Bootstrap the app and browser-storage repository

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`
- Create: `src/domain/tags.ts`, `src/storage/repository.ts`, `src/storage/indexedDb.ts`
- Test: `src/domain/tags.test.ts`, `src/storage/repository.test.ts`

- [ ] Add Vitest and Testing Library; configure `npm test` and `npm run dev`.
- [ ] Test state rules: new tags are unbound, a successful first claim binds exactly one recording, a duplicate claim is rejected, and reset clears the binding.
- [ ] Implement typed repository operations and IndexedDB audio storage with an in-memory test adapter.
- [ ] Run `npm test -- --run` and confirm domain/storage tests pass.

### Task 2: Build visitor recording and playback

**Files:**
- Create: `src/features/visitor/VisitorPage.tsx`, `src/features/visitor/useRecorder.ts`, `src/features/visitor/visitor.css`
- Test: `src/features/visitor/VisitorPage.test.tsx`
- Modify: `src/App.tsx`

- [ ] Test unbound, bound, invalid-token, permission-denied, and duplicate-submission states.
- [ ] Implement browser recording with MediaRecorder, preview, retry/retake, optional nickname, and submit through repository claim.
- [ ] Show an explicit notice that submitted voice recordings are playable by people scanning that tag.
- [ ] Implement the bound recording player and accessible loading/error states.
- [ ] Run focused visitor tests and `npm test -- --run`.

### Task 3: Build operator management

**Files:**
- Create: `src/features/admin/AdminPage.tsx`, `src/features/admin/admin.css`, `src/features/admin/csv.ts`
- Test: `src/features/admin/AdminPage.test.tsx`, `src/features/admin/csv.test.ts`
- Modify: `src/App.tsx`

- [ ] Test bulk CSV import validation, duplicate handling, export shape, listing, and reset behavior.
- [ ] Implement tag creation, random visitor URLs, CSV import/export, status filtering, audio playback, and confirmed reset.
- [ ] Make visitor and operator flows reachable from a compact navigation without exposing operator actions on visitor pages.
- [ ] Run focused admin tests and all tests.

### Task 4: Polish responsive experience and verify launch

**Files:**
- Create: `src/styles.css`, `README.md`
- Modify: `src/main.tsx`, `index.html`

- [ ] Apply a restrained exhibition-oriented visual system with responsive visitor and operator layouts, clear microphone permission states, and touch-sized controls.
- [ ] Add a seeded demo chip and explain in README that the prototype stores data only in the current browser and is not cloud-backed.
- [ ] Run `npm test -- --run`, `npm run build`, and launch `npm run dev -- --host 0.0.0.0`.
- [ ] Verify the visitor flow and operator reset in a browser; provide the local URL and known prototype limits.
