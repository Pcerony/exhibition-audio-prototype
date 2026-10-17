import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Mic, Pencil, RotateCcw, Send, Utensils, Compass, HeartHandshake, Sparkles, X } from 'lucide-react';
import type { Tag } from '../../domain/tags';
import type { VisitorRepository } from '../../storage/repository';
import { useRecorder } from './useRecorder';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';
import './visitor.css';
import { memoryLocationUrl, type MapPoint, type MemoryLocation } from '../../domain/location';
import { LocationPicker } from './LocationPicker';
import { MemoryLocationMap } from './MemoryLocationMap';
import { VisitorAudioPlayer } from './VisitorAudioPlayer';
import type { MessageKey } from '../../i18n/messages';
import { isMemoryCategoryCode, type MemoryCategoryCode } from '../../domain/classification';

type Props = { repository: VisitorRepository; token: string };

export function VisitorPage({ repository, token }: Props) {
  const { t } = useI18n();
  const [stage, setStage] = useState<'intro' | 'theme' | 'map' | 'record'>('intro');
  const [theme, setTheme] = useState<MemoryCategoryCode | ''>('');
  const [mapVisited, setMapVisited] = useState(false);
  const [tag, setTag] = useState<Tag | null | undefined>(undefined);
  const [loadedToken, setLoadedToken] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [playbackRevision, setPlaybackRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [transcriptionConsent, setTranscriptionConsent] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [location, setLocation] = useState<MemoryLocation | null>(null);
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  const audioObjectUrl = useRef('');
  const shellRef = useRef<HTMLElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const categoryDialogRef = useRef<HTMLDivElement>(null);
  const activeToken = useRef(token);
  activeToken.current = token;
  const recorder = useRecorder();

  useEffect(() => {
    let active = true;
    setTag(undefined);
    setLoadedToken('');
    setLoadFailed(false);
    setMessage('');
    setAudioUrl('');
    setJustSubmitted(false);
    setStage('intro'); setTheme(''); setMapVisited(false);
    setLocation(null);
    setMapPoint(null);
    setSubmitting(false);
    setTranscriptionConsent(false);
    setCategoryDialogOpen(false);
    recorder.discard();
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
  }, [repository, token, recorder.discard]);

  useEffect(() => {
    let active = true;
    setPlaybackFailed(false);
    setAudioUrl('');
    if (justSubmitted || !tag?.recording) {
      setAudioUrl('');
      return;
    }
    repository.getVisitorPlaybackUrl(token).then((url) => {
      if (active && url) {
        audioObjectUrl.current = url.startsWith('blob:') ? url : '';
        setAudioUrl(url);
      } else if (active) setPlaybackFailed(true);
    }).catch(() => { if (active) setPlaybackFailed(true); });
    return () => {
      active = false;
      if (audioObjectUrl.current) URL.revokeObjectURL(audioObjectUrl.current);
      audioObjectUrl.current = '';
    };
  }, [repository, token, tag?.recording?.id, playbackRevision, justSubmitted]);

  async function submitRecording() {
    if (!recorder.blob || submitting) return;
    if (!isMemoryCategoryCode(theme)) { setStage('theme'); return; }
    setSubmitting(true);
    setMessage('');
    try {
      const result = await repository.claim(token, {
        id: crypto.randomUUID(), blob: recorder.blob, nickname: '', duration: recorder.duration, location, mapPoint, categoryCode: theme, transcriptionConsent,
      });
      if (activeToken.current !== token) return;
      if (result.status === 'claimed' || result.status === 'already-bound') {
        setTag(result.tag);
        setJustSubmitted(result.status === 'claimed');
        recorder.discard();
        setMessage(result.status === 'claimed' ? 'visitor.success' : 'visitor.duplicate');
      } else {
        setMessage('visitor.unavailable');
      }
    } catch {
      if (activeToken.current === token) setMessage('visitor.submitFailure');
    } finally {
      if (activeToken.current === token) setSubmitting(false);
    }
  }

  async function retryLoading() {
    setLoadedToken('');
    try {
      const value = await repository.getTag(token);
      if (activeToken.current !== token) return;
      setTag(value);
      setLoadFailed(false);
    } finally {
      if (activeToken.current === token) setLoadedToken(token);
    }
  }


  const tagNumber = tag ? tag.serialNumber ?? tag.label : '';
  const header = <header className="outdoor-header"><LanguageSwitch visitor /><div className="outdoor-brand"><img src={`${import.meta.env.BASE_URL}sodeslab-logo.png`} alt="SoDesLab" width="150" height="48" />{tag && <span className="visitor-tag-number" data-testid="visitor-tag-number">{t('visitor.tag', { label: tagNumber })}</span>}</div></header>;
  const loading = loadedToken !== token || tag === undefined;
  const step = stage === 'intro' ? 1 : stage === 'theme' ? 2 : stage === 'map' ? 3 : recorder.state === 'ready' ? 5 : 4;
  const stepLabel = [t('flow.intro'), t('flow.theme'), t('flow.map'), t('flow.record'), t('flow.confirm')];
  const categories = [
    { code: 'A', label: t('flow.food'), Icon: Utensils },
    { code: 'B', label: t('flow.travel'), Icon: Compass },
    { code: 'C', label: t('flow.encounter'), Icon: HeartHandshake },
    { code: 'D', label: t('flow.other'), Icon: Sparkles },
  ] as const;
  const selectedCategory = categories.find(category => category.code === theme);
  useEffect(() => {
    if (loading) return;
    const heading = Array.from(shellRef.current?.querySelectorAll('h1') ?? [])
      .find(element => !element.closest('[hidden]'));
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [stage, step, loading, Boolean(tag?.recording)]);
  useEffect(() => {
    if (categoryDialogOpen) categoryDialogRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    else categoryButtonRef.current?.focus();
  }, [categoryDialogOpen]);
  const back = () => {
    if (stage === 'theme') setStage('intro');
    else if (stage === 'map') setStage('theme');
    else if (stage === 'record') setStage('map');
  };
  return <main ref={shellRef} className="visitor-shell outdoor-shell">
    {header}
    {loading ? <section className="outdoor-loading" role="status"><span className="loading-ring" aria-hidden="true" /><p>{t('app.loading')}</p></section>
      : !tag || tag.status === 'disabled' ? <section className="outdoor-step"><h1>{!tag && !loadFailed ? t('visitor.notFoundTitle') : t('visitor.unavailable')}</h1><p>{!tag && !loadFailed ? t('visitor.notFoundBody') : t('visitor.submitFailure')}</p>{loadFailed && <button className="primary-action" onClick={() => { void retryLoading().catch(() => {}); }}>{t('flow.retry')}</button>}</section>
      : tag.recording && justSubmitted ? <section className="outdoor-step placement-view">
        <p className="step-kicker">{t('flow.thanks')}</p>
        <h1>{t('visitor.placementTitle')}</h1>
        <p className="placement-help">{t('visitor.placementHelp')}</p>
        {tag.recording.location && <>
          <MemoryLocationMap location={tag.recording.location} />
          <a className="secondary-action placement-map-link" href={memoryLocationUrl(tag.recording.location)!} target="_blank" rel="noreferrer"><ExternalLink size={20}/>{t('location.openInMaps')}</a>
        </>}
        {message && <p role="status" className="visitor-message"><Check size={22}/>{t(message)}</p>}
      </section> : tag.recording ? <section className="outdoor-step recorded-view">
        <p className="step-kicker">{message ? t('flow.thanks') : t('flow.memory')}</p>
        <h1>{tag.recording.nickname ? t('visitor.recordedTitle', { name: tag.recording.nickname }) : t('visitor.recordedAnonymous')}</h1>
        <div className="outdoor-wave" aria-hidden="true">{Array.from({length:25}, (_,i) => <i key={i} style={{height: `${20+(i*37)%80}%`}} />)}</div>
        {playbackFailed ? <button className="secondary-action" onClick={() => setPlaybackRevision(v => v+1)}><RotateCcw />{t('visitor.retryPlayback')}</button> : audioUrl ? <VisitorAudioPlayer src={audioUrl} purpose="recording" onPlaybackError={() => setPlaybackFailed(true)} /> : <p role="status">{t('visitor.loadingAudio')}</p>}
        {tag.recording.location && <a className="secondary-action" href={memoryLocationUrl(tag.recording.location)!} target="_blank" rel="noreferrer">{t('location.view')}<ArrowRight size={22}/></a>}
        {message && <p role="status" className="visitor-message"><Check size={22}/>{t(message)}</p>}
        {tag.recording.transcript?.trim() && <details className="visitor-transcript"><summary>{t('transcription.show')}</summary><p>{tag.recording.transcript}</p><small>{t('transcription.accuracy')}</small></details>}
      </section> : <>
        <div className="outdoor-progress"><span className="step-number">{String(step).padStart(2,'0')}<small> / 05</small></span><span>{stepLabel[step-1]}</span>{stage !== 'intro' && <button title={t('flow.back')} aria-label={t('flow.back')} disabled={submitting || recorder.starting || recorder.state === 'recording'} onClick={back}><ArrowLeft size={25}/></button>}</div>
        {stage === 'intro' && <section className="outdoor-step intro-step"><p className="step-kicker">{t('app.title')}</p><h1>{t('flow.slogan')}</h1><p>{t('flow.introBody')}</p><button className="primary-action" onClick={() => setStage('theme')}>{t('flow.begin')}<ArrowRight size={25}/></button></section>}
        {stage === 'theme' && <section className="outdoor-step"><h1>{t('flow.themeTitle')}</h1><div className="theme-options">{categories.map(({ code, label, Icon }) => <button key={code} aria-pressed={theme === code} onClick={() => { setTheme(code); setMapVisited(true); setStage('map'); }}><Icon size={30}/><span>{label}</span><ArrowRight size={22}/></button>)}</div></section>}
        {mapVisited && <div hidden={stage !== 'map'}><LocationPicker key={token} onDone={(value, point) => { setLocation(value); setMapPoint(point ?? null); setStage('record'); }} /></div>}
        {stage === 'record' && <section className="outdoor-step recording-view">
          <h1>{recorder.state === 'ready' ? t('flow.preview') : t('visitor.promptTitle')}</h1>
          {recorder.state !== 'ready' && <div className={`outdoor-recorder ${recorder.state}`}><Mic size={52} strokeWidth={1.7}/><p className="record-time">{formatDuration(recorder.duration)}</p><p>{recorder.state === 'recording' ? t('visitor.recordingNow') : t('visitor.recordHint')}</p></div>}
          {recorder.error && <p className="inline-error" role="alert">{recorder.error}</p>}
          {recorder.state === 'ready' && recorder.previewUrl && <><div className="outdoor-wave" aria-hidden="true">{Array.from({length:25},(_,i)=><i key={i} style={{height:`${20+(i*37)%80}%`}}/>)}</div><VisitorAudioPlayer src={recorder.previewUrl} purpose="preview" /></>}
          {recorder.state === 'ready' && <div className="review-confirmations">
            <section className="review-confirmation review-category" data-testid="review-category">
              <div className="review-confirmation-copy"><p>{t('flow.categoryConfirm', { category: selectedCategory?.label ?? '' })}</p></div>
              <button ref={categoryButtonRef} className="review-edit-button" type="button" onClick={() => setCategoryDialogOpen(true)}><Pencil size={16}/>{t('flow.changeCategory')}</button>
            </section>
            {location && <section className="review-confirmation review-location" data-testid="review-location">
              <div className="review-location-heading"><p>{t('flow.locationConfirm')}</p><button className="review-edit-button" type="button" onClick={() => setStage('map')}><Pencil size={16}/>{t('flow.changeLocation')}</button></div>
              <MemoryLocationMap location={location} />
            </section>}
          </div>}
          {categoryDialogOpen && recorder.state === 'ready' && <div className="category-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) setCategoryDialogOpen(false); }}>
            <div ref={categoryDialogRef} className="category-dialog" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title" onKeyDown={event => {
              if (event.key === 'Escape') setCategoryDialogOpen(false);
              if (event.key === 'Tab') {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const first = buttons[0];
                const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}>
              <div className="category-dialog-heading"><h2 id="category-dialog-title">{t('flow.changeCategory')}</h2><button className="category-dialog-close" type="button" aria-label={t('flow.cancel')} onClick={() => setCategoryDialogOpen(false)}><X size={22}/></button></div>
              <div className="category-dialog-options">{categories.map(({ code, label, Icon }) => <button key={code} type="button" aria-pressed={theme === code} onClick={() => { setTheme(code); setCategoryDialogOpen(false); }}><Icon size={20}/><span>{label}</span></button>)}</div>
            </div>
          </div>}
          {recorder.state === 'ready' && <div className="transcription-choice"><label><input type="checkbox" checked={transcriptionConsent} disabled={submitting} onChange={event => setTranscriptionConsent(event.target.checked)} aria-describedby="transcription-notice"/><span>{t('transcription.consent')}</span></label><p id="transcription-notice">{t('transcription.notice')}</p></div>}
          <div className="outdoor-actions">{recorder.state === 'recording' ? <button className="primary-action stop-action" onClick={recorder.stop}><span className="stop-square"/>{t('visitor.stop')}</button> : recorder.state === 'ready' ? <><button className="primary-action" disabled={submitting} onClick={submitRecording}><Send size={24}/>{submitting ? t('visitor.submitting') : t('visitor.submit')}</button><button className="secondary-action" disabled={submitting} onClick={recorder.discard}><RotateCcw size={23}/>{t('visitor.retake')}</button></> : <button className="primary-action" onClick={recorder.start} disabled={recorder.starting || submitting}><Mic size={26}/>{t('visitor.start')}</button>}</div>
          <p className="outdoor-notice">{t('flow.publicNotice')}</p>
          {message && <p className="visitor-message" role="status">{t(message)}</p>}
        </section>}
      </>}
  </main>;
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
