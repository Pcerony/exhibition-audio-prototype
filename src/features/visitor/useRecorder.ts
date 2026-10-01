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
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const previewUrlRef = useRef('');
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
    generationRef.current += 1;
    startingRef.current = false;
    setStarting(false);
    stop();
    setBlob(null);
    setDuration(0);
    setError('');
    setState('idle');
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
  }, [stop]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    discard();
    const generation = generationRef.current;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(t('visitor.browserUnsupported'));
      setState('error');
      return;
    }
    startingRef.current = true;
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (generation === generationRef.current && event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        window.clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const recorded = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!recorded.size) {
          setError(t('visitor.micError'));
          setState('error');
          return;
        }
        setBlob(recorded);
        setDuration(Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))));
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(recorded);
        setPreviewUrl(previewUrlRef.current);
        setState('ready');
      };
      startedAtRef.current = Date.now();
      recorder.start();
      startingRef.current = false;
      setStarting(false);
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
      if (!mountedRef.current || generation !== generationRef.current) return;
      stop();
      startingRef.current = false;
      setStarting(false);
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

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = () => {
      if (!document.hidden) return;
      if (startingRef.current) discard();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [stop, discard]);

  return { state, blob, duration, error, previewUrl, starting, start, stop, discard };
}
