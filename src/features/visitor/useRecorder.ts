import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

type RecorderState = 'idle' | 'recording' | 'ready' | 'error';
const MAX_RECORDING_SECONDS = 60;

export function useRecorder() {
  const { t } = useI18n();
  const [state, setState] = useState<RecorderState>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const discard = useCallback(() => {
    stop();
    setBlob(null);
    setDuration(0);
    setError('');
    setState('idle');
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  }, [stop]);

  const start = useCallback(async () => {
    discard();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(t('visitor.browserUnsupported'));
      setState('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setBlob(recorded);
        setDuration(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
        setPreviewUrl(URL.createObjectURL(recorded));
        setState('ready');
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setState('recording');
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        if (elapsed >= MAX_RECORDING_SECONDS) {
          setDuration(MAX_RECORDING_SECONDS);
          stop();
          return;
        }
        setDuration(elapsed);
      }, 250);
    } catch (cause) {
      const errorName = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : '';
      const messageKey = errorName === 'NotAllowedError' || errorName === 'SecurityError'
        ? 'visitor.micDenied'
        : errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError'
          ? 'visitor.micNoDevice'
          : errorName === 'NotReadableError' || errorName === 'TrackStartError' || errorName === 'AbortError'
            ? 'visitor.micBusy'
            : 'visitor.micError';
      setError(t(messageKey));
      setState('error');
    }
  }, [discard, stop, t]);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return { state, blob, duration, error, previewUrl, start, stop, discard };
}
