alter table public.recording_transcriptions drop constraint recording_transcriptions_error_code_check;
alter table public.recording_transcriptions add constraint recording_transcriptions_error_code_check
 check(error_code in ('PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','AUDIO_UNAVAILABLE','AUDIO_TOO_LARGE','RESULT_INVALID','TRANSCRIPTION_TIMEOUT','AUDIO_CHANGED'));
