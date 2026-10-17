# Transcription Language Implementation Plan

**Goal:** Use interface language for new recordings and let authorized staff rerun original-language AI transcription with an explicit source language.

**Architecture:** Persist a language hint on the private queue, forward it through the worker to Groq, and extend the staff versioned review contract. Preserve old text privately during retries, revoke publication, and reject stale workers/reviewers. Never batch requeue existing audio on rollout.

**Tech Stack:** React/Vitest, Supabase PostgreSQL/Edge Functions, Groq Whisper.

- [x] Stabilize API/design, then separate `supabase/` ownership from frontend/domain/repository ownership.
- [x] Write failing locale/repository/staff UI tests; implement select/retry/confirmation/queue notice and visitor locale propagation.
- [x] Add migration, Edge/worker tests and isolated PostgreSQL tests for hint propagation, allowlists, authorization, rate limits, retained old text and concurrent/stale operations.
- [x] Run full frontend/backend suite, normal/Pages builds, and mobile/desktop browser checks with synthetic data.
- [x] Review changes; back up and restore production database before migration rehearsal and deployment. Verify original 20 records unchanged apart from the new metadata column. Deploy worker/claim/staff Edge before frontend.
- [ ] Publish and verify controls on the real site without retrying participant recordings. Record limits: chosen UI language is a hint, multilingual speech may require auto, and AI output always requires review.
