# Audio Review Release

Approved scope: admin-only anomaly review and visual waveform trimming in the production web admin; immutable original audio, versioned private edits, atomic primary selection and restore. Publish the four owner-approved local edits. C001/A007 are not deleted or hidden without a separate decision.

1. Stabilize the dedicated admin-audio contract. Keep existing Android and visitor recording identity unchanged.
2. Add private version storage and optimistic-concurrency RPC. Preserve original object paths. Cancel transcription leases and unpublish text on primary changes. Queue abandoned uploads and deleted versions for cleanup.
3. Add authenticated Edge API with strict WAV validation and admin role checks. Route visitor and operator playback to the selected version.
4. Implement browser-side decode, waveform selection, preview and WAV export; integrate an admin-only review panel with persisted measurements and selection state.
5. Test domain math, auth, malformed uploads, concurrency, restore, cleanup and visitor playback. Run frontend/backend suites, normal and Pages builds.
6. Back up current production metadata; rehearse migration in a rolled-back transaction. Deploy migration and functions; publish owner-approved clips using the same authenticated API. Verify originals and stable URLs remain unchanged.
7. Deploy frontend, verify production artifact and authenticated/anonymous flows, document evidence. Do not claim completion until production tests pass.
