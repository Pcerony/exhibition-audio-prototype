import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Mic, RotateCcw, Send, Tag as TagIcon } from 'lucide-react';
import type { Tag } from '../../domain/tags';
import type { VisitorRepository } from '../../storage/repository';
import { useRecorder } from './useRecorder';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';
import './visitor.css';

type Props = { repository: VisitorRepository; token: string };

export function VisitorPage({ repository, token }: Props) {
  const { t } = useI18n();
  const [tag, setTag] = useState<Tag | null | undefined>(undefined);
  const [loadedToken, setLoadedToken] = useState('');
  const [nickname, setNickname] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const audioObjectUrl = useRef('');
  const recorder = useRecorder();

  useEffect(() => {
    let active = true;
    setTag(undefined);
    setLoadedToken('');
    setLoadFailed(false);
    setMessage('');
    setAudioUrl('');
    repository.getTag(token).then((value) => {
      if (active) {
        setTag(value);
        setLoadedToken(token);
      }
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setTag(null);
        setLoadedToken(token);
      }
    });
    return () => { active = false; };
  }, [repository, token]);

  useEffect(() => {
    let active = true;
    if (!tag?.recording) {
      setAudioUrl('');
      return;
    }
    repository.getVisitorPlaybackUrl(token).then((url) => {
      if (active && url) {
        audioObjectUrl.current = url.startsWith('blob:') ? url : '';
        setAudioUrl(url);
      }
    }).catch(() => { if (active) setMessage(t('visitor.submitFailure')); });
    return () => {
      active = false;
      if (audioObjectUrl.current) URL.revokeObjectURL(audioObjectUrl.current);
      audioObjectUrl.current = '';
    };
  }, [repository, token, tag?.recording?.id, t]);

  async function submitRecording() {
    if (!recorder.blob || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const result = await repository.claim(token, {
        id: crypto.randomUUID(), blob: recorder.blob, nickname, duration: recorder.duration,
      });
      if (result.status === 'claimed' || result.status === 'already-bound') {
        setTag(result.tag);
        recorder.discard();
        setMessage(result.status === 'claimed' ? t('visitor.success') : t('visitor.duplicate'));
      } else {
        setMessage(t('visitor.unavailable'));
      }
    } catch {
      setMessage(t('visitor.submitFailure'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadedToken !== token || tag === undefined) return <main className="visitor-shell"><p className="quiet-state">{t('app.loading')}</p></main>;
  if (!tag) return <main className="visitor-shell"><div className="visitor-topline"><span className="brand-mark"><AudioLines size={17} /></span><span>{t('app.title')}</span><span className="topline-rule" /><LanguageSwitch /></div><p className="eyebrow">EXHIBITION AUDIO</p><h1>{loadFailed ? t('visitor.unavailable') : t('visitor.notFoundTitle')}</h1><p className="visitor-intro">{loadFailed ? t('visitor.submitFailure') : t('visitor.notFoundBody')}</p></main>;
  if (tag.status === 'disabled') return <main className="visitor-shell"><div className="visitor-topline"><span className="brand-mark"><AudioLines size={17} /></span><span>{t('app.title')}</span><span className="topline-rule" /><LanguageSwitch /></div><p className="eyebrow">EXHIBITION AUDIO</p><h1>{t('visitor.unavailable')}</h1></main>;

  if (tag.recording) {
    return (
      <main className="visitor-shell">
        <div className="visitor-topline"><span className="brand-mark"><AudioLines size={17} /></span><span>{t('app.title')}</span><span className="topline-rule" /><LanguageSwitch /></div>
        <section className="recorded-view">
          <p className="eyebrow">{t('visitor.recordedEyebrow')}</p>
          <h1>{tag.recording.nickname ? t('visitor.recordedTitle', { name: tag.recording.nickname }) : t('visitor.recordedAnonymous')}</h1>
          <p className="visitor-intro">{t('visitor.recordedIntro')}</p>
          <div className="soundprint" aria-hidden="true">{Array.from({ length: 45 }, (_, index) => <i key={index} style={{ '--bar': `${18 + ((index * 37 + 13) % 76)}%` } as React.CSSProperties} />)}</div>
          <div className="player-wrap">
            {audioUrl ? <audio controls aria-label={t('visitor.player')} src={audioUrl} /> : <p className="quiet-state">{t('visitor.loadingAudio')}</p>}
            <span>{formatDuration(tag.recording.duration)}</span>
          </div>
          <p className="listening-note"><Check size={15} /> {t('visitor.listenNote')}</p>
          {message && <p className="visitor-message" role="status">{message}</p>}
        </section>
        <footer className="visitor-footer">{t('visitor.tag', { label: tag.label })}</footer>
      </main>
    );
  }

  return (
    <main className="visitor-shell">
      <div className="visitor-topline"><span className="brand-mark"><AudioLines size={17} /></span><span>{t('app.title')}</span><span className="topline-rule" /><LanguageSwitch /></div>
      <section className="recording-view">
        <p className="eyebrow">{t('visitor.newEyebrow', { label: tag.label })}</p>
        <h1>{t('visitor.promptTitle')}</h1>
        <p className="visitor-intro">{t('visitor.promptBody')}</p>
        <div className={`recorder-stage ${recorder.state}`}>
          <div className="record-orbit"><span className="record-core"><Mic size={30} strokeWidth={1.7} /></span></div>
          {recorder.state === 'recording' ? <><p className="record-state">{t('visitor.recordingNow')}</p><p className="record-time">{formatDuration(recorder.duration)}</p></> : recorder.state === 'ready' ? <><p className="record-state">{t('visitor.ready')}</p><p className="record-time">{formatDuration(recorder.duration)}</p></> : <><p className="record-state">{t('visitor.pressToRecord')}</p><p className="record-time">{t('visitor.recordHint')}</p></>}
        </div>
        {recorder.error && <p className="inline-error" role="alert">{recorder.error}</p>}
        {recorder.state === 'ready' && recorder.previewUrl && <audio className="preview-player" controls aria-label={t('visitor.preview')} src={recorder.previewUrl} />}
        <div className="record-actions">
          {recorder.state === 'recording' ? (
            <button className="primary-action stop-action" onClick={recorder.stop}><span className="stop-square" /> {t('visitor.stop')}</button>
          ) : recorder.state === 'ready' ? (
            <button className="secondary-action" onClick={recorder.discard}><RotateCcw size={16} /> {t('visitor.retake')}</button>
          ) : (
            <button className="primary-action" onClick={recorder.start}><Mic size={18} /> {t('visitor.start')}</button>
          )}
        </div>
        <p className="mic-permission-help">{t('visitor.micPermissionHelp')}</p>
        {recorder.state === 'ready' && <div className="submit-panel">
          <label htmlFor="nickname">{t('visitor.nickname')} <span>{t('visitor.optional')}</span></label>
          <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} placeholder={t('visitor.nicknamePlaceholder')} />
          <button className="primary-action submit-action" onClick={submitRecording} disabled={submitting}>
            <Send size={16} /> {submitting ? t('visitor.submitting') : t('visitor.submit')}
          </button>
        </div>}
        <p className="privacy-note">{t('visitor.publicNotice')}</p>
        {message && <p className="visitor-message" role="status">{message}</p>}
      </section>
      <footer className="visitor-footer"><TagIcon size={14} /> {t('visitor.footer')}</footer>
    </main>
  );
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
