# Japanese Language and GitHub Pages Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Japanese localization and publish the mobile prototype at a public HTTPS GitHub Pages URL.

**Architecture:** Add a small typed localization context and persistent language switch used by visitor and operator screens. Build with a GitHub Pages project base path, use hash-based public visitor links so NFC URLs survive static hosting routes, then publish the static build with GitHub Actions. Audio and metadata remain local to each browser.

**Tech Stack:** React, TypeScript, Vite, Vitest, GitHub Actions, GitHub Pages.

---

### Task 1: Add tested bilingual dictionary and language preference

**Files:**
- Create: `src/i18n/messages.ts`, `src/i18n/I18nProvider.tsx`, `src/i18n/LanguageSwitch.tsx`
- Test: `src/i18n/messages.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

- [ ] Test default Chinese locale, language persistence, and changing to Japanese.
- [ ] Implement typed Chinese/Japanese message dictionaries and provider-backed `t` helper.
- [ ] Add compact `中文 | 日本語` segmented control and wrap the app in the provider.
- [ ] Run `npm test -- --run src/i18n/messages.test.tsx`.

### Task 2: Localize visitor and operator flows

**Files:**
- Modify: `src/features/visitor/VisitorPage.tsx`, `src/features/visitor/visitor.css`
- Modify: `src/features/admin/AdminPage.tsx`, `src/features/admin/admin.css`, `src/features/admin/csv.ts`
- Test: `src/features/visitor/VisitorPage.test.tsx`, `src/features/admin/AdminPage.test.tsx`, `src/features/admin/csv.test.ts`

- [ ] Add tests proving Japanese mode changes visitor recording labels and operator labels.
- [ ] Translate visitor, recording, consent, error, status, confirmation, table, CSV header, and date strings.
- [ ] Keep optional nickname data and tag labels unchanged when switching language.
- [ ] Run all tests.

### Task 3: Make static routes and generated NFC links work on GitHub Pages

**Files:**
- Modify: `vite.config.ts`, `src/App.tsx`, `src/features/admin/AdminPage.tsx`, `src/features/admin/csv.ts`
- Test: `src/App.test.tsx`, `src/features/admin/csv.test.ts`

- [ ] Test route parsing for both `/t/<token>` local development and `#/t/<token>` Pages links.
- [ ] Configure `/exhibition-audio-prototype/` as the production base path and include it in generated CSV and table URLs.
- [ ] Keep the default route on the operator page and make its visitor preview link use hash routing.
- [ ] Run all tests and `npm run build` with `GITHUB_PAGES=true`.

### Task 4: Publish with GitHub Actions and verify phone-ready HTTPS

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`, `.gitignore`

- [ ] Add a workflow that installs from the lockfile, runs tests/build, and deploys `dist` to GitHub Pages.
- [ ] Document Japanese switching, the published preview URL, local-only persistence, and iPhone microphone requirements.
- [ ] Create a public repository named `exhibition-audio-prototype`, push the reviewed project, enable Pages workflow deployment, and wait for a successful deployment.
- [ ] Verify the HTTPS site returns successfully, the Japanese toggle works, the hash visitor route opens, and microphone permission can be requested.
- [ ] Run `npm test -- --run` and `npm run build` after the final change.
