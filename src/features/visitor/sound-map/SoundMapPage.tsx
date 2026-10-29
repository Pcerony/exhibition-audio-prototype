import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, List, Map as MapIcon, Minus, Play, Plus, RotateCw, Scan, X, RefreshCw } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider';
import { LanguageSwitch } from '../../../i18n/LanguageSwitch';
import type { SoundMapEntry, SoundMapRepository } from '../../../storage/soundMapRepository';
import { memoryLocationUrl } from '../../../domain/location';
import { VisitorAudioPlayer } from '../VisitorAudioPlayer';
import { modelPoint, inSoundMap, type MapPoint } from './geography';
import { mountSoundMap, topicColors, type SoundMapScene } from './scene';
import { soundMapMessages } from './soundMapMessages';
import './sound-map.css';

type Props = { repository: SoundMapRepository; onClose: () => void; onContinue?: () => void; focusRecordingId?: string };

export function SoundMapPage({ repository, onClose, onContinue, focusRecordingId }: Props) {
  const { locale } = useI18n();
  const copy = soundMapMessages[locale];
  const surface = useRef<HTMLDivElement>(null), markers = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null), scene = useRef<SoundMapScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false), [sceneFailed, setSceneFailed] = useState(false);
  const [entries, setEntries] = useState<SoundMapEntry[] | null>(null), [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0), [points, setPoints] = useState(new Map<string, MapPoint>());
  const [listOpen, setListOpen] = useState(false);
  const [group, setGroup] = useState<SoundMapEntry[] | null>(null), [selected, setSelected] = useState<SoundMapEntry | null>(null);
  const [audioUrl, setAudioUrl] = useState(''), [audioFailed, setAudioFailed] = useState(false), [playbackRevision, setPlaybackRevision] = useState(0);
  const focused = useRef(false);
  const chooseGroup = useCallback((values: SoundMapEntry[]) => {
    setListOpen(false);
    if (values.length === 1) { setGroup(null); setSelected(values[0]); }
    else { setSelected(null); setGroup(values); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoadFailed(false); setEntries(null);
    repository.list(controller.signal).then(values => {
      if (!controller.signal.aborted) { setEntries(values); setSelected(current => current && values.some(v => v.id === current.id) ? current : null); }
    }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [repository, revision]);
  useEffect(() => {
    if (!entries) return;
    const resolved = new Map<string, MapPoint>();
    for (const entry of entries) if (entry.location?.source === 'pin') resolved.set(entry.id, modelPoint(entry.location));
    setPoints(new Map(resolved));
    // Places results may only be plotted on a Google Map, not on this independent model.
  }, [entries]);
  useEffect(() => {
    let active = true; setSceneReady(false); setSceneFailed(false); focused.current = false;
    void mountSoundMap({ surface: surface.current!, markers: markers.current!, labels: labels.current!, copy,
      reserved: () => Array.from(shell.current?.querySelectorAll<HTMLElement>('[data-map-reserved]') ?? [])
        .filter(el => !el.hidden && el.getBoundingClientRect().width > 0).map(el => el.getBoundingClientRect()),
      onSelect: chooseGroup, onUnavailable: () => { if (active) setSceneFailed(true); },
    }).then(value => {
      if (!active) { value.dispose(); return; }
      scene.current = value; setSceneReady(true);
    }).catch(() => { if (active) setSceneFailed(true); });
    return () => { active = false; scene.current?.dispose(); scene.current = null; };
  }, [copy, chooseGroup]);
  const voices = useMemo(() => (entries ?? []).flatMap(entry => {
    const point = points.get(entry.id); return point && inSoundMap(point) ? [{ entry, point }] : [];
  }), [entries, points]);
  useEffect(() => {
    if (!sceneReady) return;
    scene.current?.setVoices(voices);
    if (focusRecordingId && !focused.current && voices.some(v => v.entry.id === focusRecordingId)) {
      scene.current?.focus(focusRecordingId); focused.current = true;
    }
  }, [sceneReady, voices, focusRecordingId]);
  useEffect(() => { scene.current?.select(selected?.id ?? focusRecordingId ?? null); }, [selected, sceneReady, focusRecordingId]);
  useEffect(() => {
    let active = true, blobUrl = '';
    setAudioUrl(''); setAudioFailed(false);
    if (!selected) return;
    repository.playback(selected).then(url => {
      if (!active) { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); return; }
      if (!url) { setAudioFailed(true); return; }
      if (url.startsWith('blob:')) blobUrl = url;
      setAudioUrl(url);
    }).catch(() => { if (active) setAudioFailed(true); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [selected, repository, playbackRevision]);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    shell.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, []);
  const topics = { A: copy.food, B: copy.travel, C: copy.encounter, D: copy.other };
  const topic = (entry: SoundMapEntry) => entry.categoryCode ? topics[entry.categoryCode] : copy.unknown;
  const showList = listOpen || sceneFailed;
  function closePanel() { setSelected(null); setGroup(null); }
  function date(entry: SoundMapEntry) {
    const value = new Date(entry.createdAt);
    return Number.isNaN(value.getTime()) ? '' : new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(value);
  }
  function entryButton(entry: SoundMapEntry) {
    const point = points.get(entry.id);
    const hint = !entry.location ? copy.unlocated : entry.location.source === 'place' ? copy.externalPlace : !point || !inSoundMap(point) ? copy.unresolved : '';
    return <button key={entry.id} type="button" className="sm-entry" onClick={() => { if (point && inSoundMap(point)) scene.current?.focus(entry.id); setGroup(null); setSelected(entry); setListOpen(false); }}>
      <span className="sm-entry-dot" style={{ background: topicColors[entry.categoryCode ?? ''] ?? '#69796f' }} />
      <span className="sm-entry-copy"><strong>{entry.label}</strong><small>{topic(entry)} · {Math.round(entry.durationSeconds)} {copy.seconds} · {date(entry)}{hint && ` · ${hint}`}</small></span><Play size={17} aria-hidden="true" />
    </button>;
  }
  return <main ref={shell} tabIndex={-1} className="sound-map-shell" aria-label={copy.title} onKeyDown={event => { if (event.key === 'Escape') { if (selected || group || listOpen) { closePanel(); setListOpen(false); } else onClose(); } }}>
    <div ref={surface} className="sm-world" /><div ref={labels} className="sm-labels" aria-hidden="true" /><div ref={markers} className="sm-markers" />
    <header className="sm-header"><div className="sm-brand" data-map-reserved><img src={`${import.meta.env.BASE_URL}sodeslab-logo.png`} alt="SoDesLab" width="133" height="38" /><h1>{copy.title}</h1><p>{copy.subtitle}</p><small role="status">{entries ? `${entries.length} ${copy.count}` : loadFailed ? copy.failed : copy.loading}</small></div><div className="sm-header-actions" data-map-reserved><LanguageSwitch visitor /><button className="sm-icon" type="button" title={copy.back} aria-label={copy.back} onClick={onClose}><ArrowLeft size={20}/></button></div></header>
    <nav className="sm-tools" data-map-reserved aria-label={copy.map}>
      <button className="sm-icon" disabled={!sceneReady || sceneFailed} title={copy.zoomIn} aria-label={copy.zoomIn} onClick={() => scene.current?.zoom(1.25)}><Plus size={20}/></button>
      <button className="sm-icon" disabled={!sceneReady || sceneFailed} title={copy.zoomOut} aria-label={copy.zoomOut} onClick={() => scene.current?.zoom(0.8)}><Minus size={20}/></button>
      <button className="sm-icon" disabled={!sceneReady || sceneFailed} title={copy.rotate} aria-label={copy.rotate} onClick={() => scene.current?.rotate()}><RotateCw size={20}/></button>
      <button className="sm-icon" disabled={!sceneReady || sceneFailed} title={copy.reset} aria-label={copy.reset} onClick={() => scene.current?.reset()}><Scan size={20}/></button>
      <button className="sm-icon" disabled={sceneFailed} aria-pressed={showList} title={showList && !sceneFailed ? copy.map : copy.list} aria-label={showList && !sceneFailed ? copy.map : copy.list} onClick={() => { closePanel(); setListOpen(!listOpen); }}>{showList && !sceneFailed ? <MapIcon size={20}/> : <List size={20}/>}</button>
    </nav>
    {(!sceneReady && !sceneFailed || !entries && !loadFailed) && <div className="sm-loading" role="status">{copy.loading}</div>}
    {loadFailed && <section className="sm-feedback" role="alert"><p>{copy.failed}</p><button onClick={() => setRevision(v => v + 1)}><RefreshCw size={18}/>{copy.retry}</button></section>}
    {entries?.length === 0 && <div className="sm-feedback" role="status">{copy.empty}</div>}
    <p className="sm-credit" data-map-reserved><a href="https://www.mlit.go.jp/plateau/site-policy/" target="_blank" rel="noreferrer">Project PLATEAU / 福岡市</a> · 簡略化・高さ調整 · 建物調査 2022</p>
    <div className="sm-legend" data-map-reserved>{Object.entries(topics).map(([code, text]) => <span key={code}><i style={{ background: topicColors[code] }}/>{text}</span>)}</div>
    <button className="sm-continue" data-map-reserved onClick={onContinue ?? onClose}>{onContinue ? copy.leave : copy.back}<ArrowRight size={20}/></button>
    {(showList || group || selected) && <section className={`sm-panel${showList ? ' is-list' : ''}`} aria-label={selected?.label ?? copy.list}>
      <div className="sm-panel-heading"><h2>{selected?.label ?? (group ? `${copy.group} · ${group.length}` : copy.list)}</h2><button className="sm-icon" title={copy.close} aria-label={copy.close} onClick={() => { if (sceneFailed && !selected && !group) { onClose(); return; } closePanel(); setListOpen(false); }}><X size={20}/></button></div>
      {sceneFailed && <p className="sm-fallback">{copy.fallback}</p>}
      {selected ? <><p className="sm-audio-meta">{topic(selected)} · {Math.round(selected.durationSeconds)} {copy.seconds} · {date(selected)}</p>
        {selected.location?.source === 'place' && <a className="sm-place-link" href={memoryLocationUrl(selected.location)!} target="_blank" rel="noreferrer"><ExternalLink size={16}/>{copy.externalPlace}</a>}
        {audioFailed ? <div role="alert"><p>{copy.unavailable}</p><button className="sm-retry" onClick={() => setPlaybackRevision(v => v + 1)}><RefreshCw size={18}/>{copy.retry}</button></div>
          : audioUrl ? <VisitorAudioPlayer key={`${selected.id}:${playbackRevision}`} src={audioUrl} purpose="recording" onPlaybackError={() => setAudioFailed(true)} /> : <p role="status">{copy.loadingAudio}</p>}
      </> : <div className="sm-entry-list">{(group ?? entries ?? []).map(entryButton)}</div>}
    </section>}
  </main>;
}
