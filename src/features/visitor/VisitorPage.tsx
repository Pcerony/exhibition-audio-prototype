import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Mic, RotateCcw, Send, Utensils, Compass, HeartHandshake, Sparkles } from 'lucide-react';
import type { Tag } from '../../domain/tags';
import type { VisitorRepository } from '../../storage/repository';
import { useRecorder } from './useRecorder';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';
import './visitor.css';
import { memoryLocationUrl, type MemoryLocation } from '../../domain/location';
import { LocationPicker } from './LocationPicker';

type Props = { repository: VisitorRepository; token: string };

export function VisitorPage({ repository, token }: Props) {
  const { t, locale } = useI18n();
  const ja = locale === 'ja-JP';
  const [stage, setStage] = useState<'intro' | 'theme' | 'map' | 'record'>('intro');
  const [theme, setTheme] = useState('');
  const [mapVisited, setMapVisited] = useState(false);
  const [tag, setTag] = useState<Tag | null | undefined>(undefined);
  const [loadedToken, setLoadedToken] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [playbackRevision, setPlaybackRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [location, setLocation] = useState<MemoryLocation | null>(null);
  const audioObjectUrl = useRef('');
  const shellRef = useRef<HTMLElement>(null);
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
    setStage('intro'); setTheme(''); setMapVisited(false);
    setLocation(null);
    setSubmitting(false);
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
    if (!tag?.recording) {
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
  }, [repository, token, tag?.recording?.id, playbackRevision]);

  async function submitRecording() {
    if (!recorder.blob || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const result = await repository.claim(token, {
        id: crypto.randomUUID(), blob: recorder.blob, nickname: '', duration: recorder.duration, location,
      });
      if (activeToken.current !== token) return;
      if (result.status === 'claimed' || result.status === 'already-bound') {
        setTag(result.tag);
        recorder.discard();
        setMessage(result.status === 'claimed' ? t('visitor.success') : t('visitor.duplicate'));
      } else {
        setMessage(t('visitor.unavailable'));
      }
    } catch {
      if (activeToken.current === token) setMessage(t('visitor.submitFailure'));
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


  const header = <header className="outdoor-header"><LanguageSwitch /><img src={`${import.meta.env.BASE_URL}sodeslab-logo.png`} alt="SoDesLab" width="150" height="48" /></header>;
  const loading = loadedToken !== token || tag === undefined;
  const step = stage === 'intro' ? 1 : stage === 'theme' ? 2 : stage === 'map' ? 3 : recorder.state === 'ready' ? 5 : 4;
  const stepLabel = ja ? ['はじめに', 'テーマ', '場所', '録音', '確認'] : ['说明', '主题', '地点', '录音', '确认'];
  useEffect(() => {
    if (loading) return;
    const heading = Array.from(shellRef.current?.querySelectorAll('h1') ?? [])
      .find(element => !element.closest('[hidden]'));
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [stage, step, loading, Boolean(tag?.recording)]);
  const back = () => {
    if (stage === 'theme') setStage('intro');
    else if (stage === 'map') setStage('theme');
    else if (stage === 'record') setStage('map');
  };
  return <main ref={shellRef} className="visitor-shell outdoor-shell">
    {header}
    {loading ? <section className="outdoor-loading" role="status"><span className="loading-ring" aria-hidden="true" /><p>{t('app.loading')}</p></section>
      : !tag || tag.status === 'disabled' ? <section className="outdoor-step"><h1>{!tag && !loadFailed ? t('visitor.notFoundTitle') : t('visitor.unavailable')}</h1><p>{!tag && !loadFailed ? t('visitor.notFoundBody') : t('visitor.submitFailure')}</p>{loadFailed && <button className="primary-action" onClick={() => { void retryLoading().catch(() => {}); }}>{ja ? 'もう一度' : '重试'}</button>}</section>
      : tag.recording ? <section className="outdoor-step recorded-view">
        <p className="step-kicker">{message ? (ja ? 'ありがとう' : '谢谢你的分享') : (ja ? '福岡の思い出' : '福冈回忆')}</p>
        <h1>{tag.recording.nickname ? t('visitor.recordedTitle', { name: tag.recording.nickname }) : t('visitor.recordedAnonymous')}</h1>
        <div className="outdoor-wave" aria-hidden="true">{Array.from({length:25}, (_,i) => <i key={i} style={{height: `${20+(i*37)%80}%`}} />)}</div>
        {playbackFailed ? <button className="secondary-action" onClick={() => setPlaybackRevision(v => v+1)}><RotateCcw />{t('visitor.retryPlayback')}</button> : audioUrl ? <audio className="preview-player" controls aria-label={t('visitor.player')} src={audioUrl} onError={() => setPlaybackFailed(true)} /> : <p role="status">{t('visitor.loadingAudio')}</p>}
        {tag.recording.location && <a className="secondary-action" href={memoryLocationUrl(tag.recording.location)!} target="_blank" rel="noreferrer">{t('location.view')}<ArrowRight size={22}/></a>}
        {message && <p role="status" className="visitor-message"><Check size={22}/>{message}</p>}
      </section> : <>
        <div className="outdoor-progress"><span className="step-number">{String(step).padStart(2,'0')}<small> / 05</small></span><span>{stepLabel[step-1]}</span>{stage !== 'intro' && <button title={ja ? '戻る' : '返回'} aria-label={ja ? '戻る' : '返回'} disabled={submitting || recorder.starting || recorder.state === 'recording'} onClick={back}><ArrowLeft size={25}/></button>}</div>
        {stage === 'intro' && <section className="outdoor-step intro-step"><p className="step-kicker">FUKUOKA VOICE MEMORIES</p><h1>{ja ? <>あなたの声で、<br/>福岡を残そう。</> : <>用你的声音，<br/>留下福冈的回忆。</>}</h1><p>{ja ? 'この街の思い出を、ひとつ。' : '分享一段属于你与这座城市的记忆。'}</p><button className="primary-action" onClick={() => setStage('theme')}>{ja ? 'はじめる' : '开始'}<ArrowRight size={25}/></button></section>}
        {stage === 'theme' && <section className="outdoor-step"><h1>{ja ? 'どんな思い出？' : '你想分享哪种回忆？'}</h1><div className="theme-options">{[
          ['food',ja ? '食べもの' : '饮食',Utensils],
          ['travel',ja ? '旅・おでかけ' : '旅行',Compass],
          ['encounter',ja ? '出会い' : '相遇',HeartHandshake],
          ['other',ja ? 'そのほかの思い出' : '未分类回忆',Sparkles],
        ].map(([id,label,Icon]) => { const Symbol = Icon as typeof Mic; return <button key={String(id)} aria-pressed={theme===id} onClick={() => { setTheme(String(id)); setMapVisited(true); setStage('map'); }}><Symbol size={30}/><span>{String(label)}</span><ArrowRight size={22}/></button>; })}</div></section>}
        {mapVisited && <div hidden={stage !== 'map'}><LocationPicker key={token} onDone={value => { setLocation(value); setStage('record'); }} /></div>}
        {stage === 'record' && <section className="outdoor-step recording-view">
          <h1>{recorder.state === 'ready' ? (ja ? '声を聞いてみよう。' : '听听你的声音。') : t('visitor.promptTitle')}</h1>
          {recorder.state !== 'ready' && <div className={`outdoor-recorder ${recorder.state}`}><Mic size={52} strokeWidth={1.7}/><p className="record-time">{formatDuration(recorder.duration)}</p><p>{recorder.state === 'recording' ? t('visitor.recordingNow') : t('visitor.recordHint')}</p></div>}
          {recorder.error && <p className="inline-error" role="alert">{recorder.error}</p>}
          {recorder.state === 'ready' && recorder.previewUrl && <><div className="outdoor-wave" aria-hidden="true">{Array.from({length:25},(_,i)=><i key={i} style={{height:`${20+(i*37)%80}%`}}/>)}</div><audio className="preview-player" controls aria-label={t('visitor.preview')} src={recorder.previewUrl}/></>}
          <div className="outdoor-actions">{recorder.state === 'recording' ? <button className="primary-action stop-action" onClick={recorder.stop}><span className="stop-square"/>{t('visitor.stop')}</button> : recorder.state === 'ready' ? <><button className="primary-action" disabled={submitting} onClick={submitRecording}><Send size={24}/>{submitting ? t('visitor.submitting') : t('visitor.submit')}</button><button className="secondary-action" disabled={submitting} onClick={recorder.discard}><RotateCcw size={23}/>{t('visitor.retake')}</button></> : <button className="primary-action" onClick={recorder.start} disabled={recorder.starting || submitting}><Mic size={26}/>{t('visitor.start')}</button>}</div>
          <p className="outdoor-notice">{ja ? '送信した音声は、このタグから誰でも聞けます。' : '提交后，扫描这枚展签的人都可以收听。'}</p>
          {message && <p className="visitor-message" role="status">{message}</p>}
        </section>}
      </>}
  </main>;
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
