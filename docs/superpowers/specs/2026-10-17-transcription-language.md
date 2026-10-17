# Transcription Language and Staff Retry

The owner requested language-guided original-language transcription, not translation. Use visitor UI language for new consented recordings (ja/zh/en/ko; both Chinese locales map to zh), Japanese for missing legacy-client input. Staff can select ja, zh, en, ko, es, fr, de, it, pt, ru, vi, th, id, ar, hi, or auto before requesting a new AI transcription. No bulk retry of the existing 20 recordings.

## Contract

- `public-upload-claim` accepts optional `transcriptionLanguage`; invalid values fail before any cloud mutation. Map to SQL `p_language_hint`; keep the original SQL signature available for legacy callers.
- `recording_transcriptions.language_hint` stores the selected ISO code or `auto`. Existing rows get ja without requeueing, changing text, or changing publication.
- `claim_transcription` returns `languageHint`. Worker sends `language` only for an explicit code and omits it for auto; old missing task field defaults ja. Keep the transcription endpoint/model, not the translation endpoint. A language constraint improves recognition but cannot guarantee correctness.
- `POST staff-api {action:'retryTranscription',recordingId,memberId,version,languageHint}` requires verified staff/operator/admin, valid member, current binding, consent, integer observed version, configured provider, and language allowlist. Retry is rate limited to once per recording per minute and cannot repeat while pending/processing.
- Retry keeps previous text as reference, immediately withdraws publication, resets attempts/lease/error, sets pending and selected language, increments version. Atomic tag-first locking and version check ensure one winner; late old AI completion cannot replace the new task.
- Audit `staff_retry_transcription` records member snapshot, language, previous publication and time, never transcript/audio/secrets. Existing list DTO gains `transcription.languageHint`.
- Staff detail uses a native language select and retry confirmation. Dirty edits require explicit discard confirmation; errors preserve edits. Success closes/refreshes with queued notice; pending/processing cannot accidentally publish the retained old result.

## Verification

Failing-then-passing worker/Edge/SQL/UI/repository tests, migration replay and concurrent retry on isolated PostgreSQL; full frontend/backend and both builds; synthetic browser checks. Production rollout requires a fresh encrypted backup and rollback rehearsal; do not send participant audio or change existing publication/text during rollout verification.
