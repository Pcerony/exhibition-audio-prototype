import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  History,
  MapPin,
  Play,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import type {
  StaffCard,
  StaffHistory,
  StaffMember,
  StaffRepository,
} from '../../storage/staffRepository';
import { OperatorDialog } from '../admin/OperatorDialog';
import { VisitorAudioPlayer } from '../visitor/VisitorAudioPlayer';
import { staffTime, type StaffMessages } from './staffMessages';
import type { StaffTab } from './StaffPage';
import { transcriptionLanguages, type TranscriptionLanguage } from '../../domain/transcriptionLanguage';
const StaffLocationPanel = lazy(() => import('./StaffLocationPanel'));

export function StaffDetail({
  repository,
  card: original,
  member,
  initialTab,
  initialAudio,
  m,
  onAuthError,
  onClose,
  onSaved,
  onRetried,
}: {
  repository: StaffRepository;
  card: StaffCard;
  member: StaffMember;
  initialTab: StaffTab;
  initialAudio: boolean;
  m: StaffMessages;
  onAuthError: (cause: unknown) => void;
  onClose: () => void;
  onSaved: (published: boolean) => void;
  onRetried: (languageHint: TranscriptionLanguage) => void;
}) {
  const [card, setCard] = useState(original),
    [tab, setTab] = useState(initialTab),
    [text, setText] = useState(original.recording?.transcription?.text ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false);
  const [languageHint, setLanguageHint] = useState<TranscriptionLanguage>(original.recording?.transcription?.languageHint ?? 'ja');
  const [audio, setAudio] = useState<string | null>(null),
    [audioBusy, setAudioBusy] = useState(false),
    [audioFailed, setAudioFailed] = useState(false);
  const [entries, setEntries] = useState<StaffHistory[] | null>(null),
    [historyLoading, setHistoryLoading] = useState(false);
  const active = useRef(true),
    working = useRef(false),
    audioWorking = useRef(false);
  const recording = card.recording,
    task = recording?.transcription;
  const dirty = text !== (task?.text ?? '');
  const processing = task?.status === 'pending' || task?.status === 'processing';
  function fail(cause: unknown) {
    const code = cause instanceof Error ? cause.message : '';
    if (['AUTH_REQUIRED', 'STAFF_REQUIRED', 'MEMBER_REQUIRED'].includes(code)) {
      onAuthError(cause);
      return;
    }
    if (code === 'VERSION_CONFLICT') {
      setStale(true);
      setError(m.stale);
    } else setError(code === 'RECORDING_NOT_FOUND' ? m.unavailable
      : code === 'TRANSCRIPTION_RATE_LIMITED' ? m.retryRateLimited
      : code === 'TRANSCRIPTION_IN_PROGRESS' ? m.processing
      : code === 'TRANSCRIPTION_NOT_CONFIGURED' ? m.retryNotConfigured : m.error);
  }
  async function loadAudio() {
    if (!recording || audioWorking.current) return;
    audioWorking.current = true;
    setAudioBusy(true);
    setAudioFailed(false);
    setAudio(null);
    try {
      const url = await repository.playback(recording.id, member.id);
      if (active.current) setAudio(url);
    } catch (cause) {
      if (active.current) {
        setAudioFailed(true);
        fail(cause);
      }
    } finally {
      audioWorking.current = false;
      if (active.current) setAudioBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    if (initialAudio) void loadAudio();
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (tab !== 'history') return;
    let live = true;
    setHistoryLoading(true);
    repository
      .history(card.id)
      .then((value) => {
        if (live) setEntries(value);
      })
      .catch((cause) => {
        if (live) fail(cause);
      })
      .finally(() => {
        if (live) setHistoryLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tab, repository, card.id]);
  useEffect(() => {
    if (tab !== 'location' || !recording || card.status !== 'bound') return;
    void repository.viewLocation(recording.id, member.id).catch((cause) => {
      if (active.current) fail(cause);
    });
  }, [tab, repository, recording?.id, member.id]);
  async function save(published: boolean) {
    if (
      !recording ||
      !task ||
      processing ||
      working.current ||
      stale ||
      !recording.transcriptionConsent
    )
      return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await repository.save(
        recording.id,
        member.id,
        task.version,
        text,
        published,
      );
      if (active.current) onSaved(published);
    } catch (cause) {
      if (active.current) fail(cause);
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function reload() {
    if (working.current || (dirty && !window.confirm(m.discard))) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await repository.list({ tagId: card.id, limit: 1 });
      if (!active.current) return;
      const latest = result.cards[0];
      if (
        !latest ||
        latest.recording?.id !== recording?.id ||
        latest.status !== 'bound'
      )
        throw Error('RECORDING_NOT_FOUND');
      setCard(latest);
      setText(latest.recording?.transcription?.text ?? '');
      setLanguageHint(latest.recording?.transcription?.languageHint ?? 'ja');
      setStale(false);
    } catch (cause) {
      if (active.current) fail(cause);
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }
  function close() {
    if (!busy && (!dirty || window.confirm(m.discard))) onClose();
  }
  async function retry() {
    if (!recording || !task || working.current || stale || processing || !recording.transcriptionConsent) return;
    if (!window.confirm(m.retryConfirm + (dirty ? '\n' + m.discard : ''))) return;
    working.current = true; setBusy(true); setError('');
    try {
      await repository.retryTranscription(recording.id, member.id, task.version, languageHint);
      if (active.current) onRetried(languageHint);
    } catch (cause) { if (active.current) fail(cause); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  return (
    <OperatorDialog titleId="staff-detail-title" locked={busy} onClose={close}>
      <header className="staff-detail-head">
        <div>
          <h2 id="staff-detail-title">{card.label}</h2>
          <time dateTime={recording?.createdAt ?? card.createdAt}>
            {staffTime(recording?.createdAt ?? card.createdAt)} JST
          </time>
        </div>
        <button
          className="staff-icon"
          title={m.close}
          aria-label={m.close}
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div role="tablist" className="staff-tabs" aria-label={card.label}>
        {(
          [
            { id: 'review', label: m.review, Icon: FileText },
            { id: 'location', label: m.location, Icon: MapPin },
            { id: 'history', label: m.history, Icon: History },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            role="tab"
            key={id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      <div className="staff-detail-body">
        {tab === 'review' && (
          <>
            {recording && (
              <div className="staff-audio">
                <button
                  className="staff-action"
                  disabled={audioBusy}
                  onClick={() => void loadAudio()}
                >
                  <Play size={17} />
                  {audio ? m.reloadAudio : m.listen}
                </button>
                <span>{recording.duration}s</span>
                {audioBusy && <p role="status">{m.loading}</p>}
                {audio && (
                  <VisitorAudioPlayer
                    key={audio}
                    src={audio}
                    purpose="recording"
                    onPlaybackError={() => setAudioFailed(true)}
                  />
                )}
                {audioFailed && (
                  <p className="staff-error" role="alert">
                    {m.audioError}
                  </p>
                )}
              </div>
            )}
            {task && (
              <p className="staff-reviewer">
                {task.status === 'pending'
                  ? m.queued
                  : task.status === 'processing'
                    ? m.processing
                    : task.status === 'failed'
                      ? m.failed
                      : task.published
                        ? m.approved
                        : m.unreviewed}
              </p>
            )}
            {recording?.transcriptionConsent && task ? (
              <>
              <div className="staff-retranscribe">
                <label>{m.sourceLanguage}
                  <select aria-label={m.sourceLanguage} value={languageHint} disabled={busy || processing || stale}
                    onChange={event => setLanguageHint(event.target.value as TranscriptionLanguage)}>
                    {transcriptionLanguages.map(language => <option key={language.code} value={language.code}>{language.code === 'auto' ? m.autoLanguage : language.label}</option>)}
                  </select>
                </label>
                <button className="staff-action" disabled={busy || stale || processing} onClick={() => void retry()}>
                  <RefreshCw size={17}/>{m.retryTranscription}
                </button>
              </div>
              <label className="staff-editor">
                {m.text}
                <textarea
                  aria-label={m.text}
                  rows={9}
                  value={text}
                  maxLength={10000}
                  disabled={busy || processing}
                  onChange={(event) => setText(event.target.value)}
                />
                <small>{Array.from(text).length} / 10000</small>
              </label>
              </>
            ) : (
              <p className="staff-empty">
                {recording && !recording.transcriptionConsent
                  ? m.noConsent
                  : m.noTask}
              </p>
            )}
          </>
        )}
        {tab === 'location' && (
          <Suspense fallback={<p role="status">{m.loading}</p>}>
            <StaffLocationPanel card={card} m={m} />
          </Suspense>
        )}
        {tab === 'history' &&
          (historyLoading ? (
            <p role="status">{m.loading}</p>
          ) : !entries?.length ? (
            <p className="staff-empty">{m.noHistory}</p>
          ) : (
            <ol className="staff-history">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.memberName}</strong>
                    <span>
                      {m.activity[
                        entry.action as keyof StaffMessages['activity']
                      ] ?? entry.action}
                    </span>
                  </div>
                  <time dateTime={entry.createdAt}>
                    {staffTime(entry.createdAt)} JST
                  </time>
                </li>
              ))}
            </ol>
          ))}
      </div>
      {tab === 'review' && (
        <footer className="staff-detail-footer">
          <button
            className="staff-icon"
            title={m.reload}
            aria-label={m.reload}
            disabled={busy}
            onClick={() => void reload()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="staff-action"
            disabled={
              busy ||
              processing ||
              stale ||
              !task ||
              !recording?.transcriptionConsent ||
              ((task.status === 'pending' || task.status === 'processing') &&
                !text.trim())
            }
            onClick={() => void save(false)}
          >
            <Save size={17} />
            {m.draft}
          </button>
          <button
            className="staff-primary"
            disabled={
              busy ||
              processing ||
              stale ||
              !task ||
              !recording?.transcriptionConsent ||
              !text.trim()
            }
            onClick={() => void save(true)}
          >
            <Check size={18} />
            {m.publish}
          </button>
        </footer>
      )}
    </OperatorDialog>
  );
}
