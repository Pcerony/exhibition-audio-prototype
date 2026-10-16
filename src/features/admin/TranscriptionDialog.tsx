import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, RotateCcw, Save, X } from 'lucide-react';
import type { AdminRepository } from '../../storage/adminRepository';
import type { TranscriptionResult } from '../../domain/transcription';
import { OperatorDialog } from './OperatorDialog';
import { transcriptionMessages } from './transcriptionMessages';

type Props = {
  repository: Pick<AdminRepository, 'getTranscription' | 'retryTranscription' | 'saveTranscription'>;
  recordingId: string;
  label: string;
  locale: 'ja-JP' | 'zh-CN';
  onAuthError: (cause: unknown) => void;
  onClose: () => void;
};

export function TranscriptionDialog({ repository, recordingId, label, locale, onAuthError, onClose }: Props) {
  const m = transcriptionMessages[locale];
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [text, setText] = useState('');
  const dirty = useRef(false);
  const [busy, setBusy] = useState(true);
  const working = useRef(false);
  const active = useRef(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const task = result?.transcription;
  const editable = !!task && !!result?.consented && !busy && !stale;
  function failure(cause: unknown) {
    const code = cause instanceof Error ? cause.message : '';
    if (code === 'AUTH_REQUIRED' || code === 'OPERATOR_REQUIRED') {
      setResult(null);
      setText('');
      onAuthError(cause);
    } else if (code === 'VERSION_CONFLICT') {
      setStale(true);
      setError(m.stale);
    } else setError(m.error);
  }
  async function load() {
    const value = await repository.getTranscription(recordingId);
    if (!active.current) return;
    setResult(value);
    if (!dirty.current) setText(value.transcription?.text ?? '');
    setStale(false);
  }
  async function run(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); } catch (cause) { if (active.current) failure(cause); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true;
    void run(load);
    return () => { active.current = false; };
  }, [repository, recordingId]);
  async function save(published: boolean) {
    if (!task || !editable || (published && !text.trim()) || text.length > 10000) return;
    await repository.saveTranscription(recordingId, task.version, text, published);
    dirty.current = false;
    // A successful mutation invalidates the old version, even if the follow-up read fails.
    setStale(true);
    await load();
    if (active.current) setNotice(m.saved);
  }
  return (
    <OperatorDialog titleId="transcription-title" locked={busy} onClose={onClose}>
      <h2 id="transcription-title">{m.title} · {label}</h2>
      {error && <p className="admin-message error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{m.loading}</p>}
      {result && <>
        {!result.configured && <p>{m.notConfigured}</p>}
        {!result.consented && <p>{m.noConsent}</p>}
        {task ? <p className="transcription-status">{m[task.status]} · {task.published ? m.published : m.hidden}</p> : <p>{m.noTask}</p>}
      </>}
      {task && result?.consented && <label className="transcription-editor">
        {m.text}
        <textarea aria-label={m.text} value={text} maxLength={10000} disabled={busy} onChange={(event) => { dirty.current = true; setText(event.target.value); }} />
        <span className="transcription-count">{text.length} / 10000</span>
      </label>}
      <footer>
        <button disabled={busy} onClick={onClose}><X size={16} />{m.close}</button>
        <button disabled={busy} onClick={() => void run(load)}><RefreshCw size={16} />{m.refresh}</button>
        <button disabled={!editable || !result?.configured} onClick={() => void run(async () => {
          if (!task) return;
          await repository.retryTranscription(recordingId, task.version);
          dirty.current = false;
          setStale(true);
          await load();
          if (active.current) setNotice(m.retried);
        })}><RotateCcw size={16} />{m.retry}</button>
        <button disabled={!editable} onClick={() => void run(() => save(false))}><Save size={16} />{m.draft}</button>
        {task?.published && <button disabled={!editable} onClick={() => void run(() => save(false))}><EyeOff size={16} />{m.hide}</button>}
        <button className="toolbar-primary" disabled={!editable || !text.trim()} onClick={() => void run(() => save(true))}><Eye size={16} />{m.publish}</button>
      </footer>
    </OperatorDialog>
  );
}
