import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Pause, Play, RotateCcw, Save, ScanLine, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { AudioAdminRepository, AudioDetail, AudioReviewItem } from '../../storage/audioAdminRepository';
import { audioReviewFlags } from '../../domain/audioReview';
import { decodeReviewAudio, encodeAudioClip, waveformPeaks } from '../../domain/audioEditing';
import './audio-review.css';

const format = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const labels = { short: '过短 / 短すぎる', long: '过长 / 長すぎる', durationMismatch: '时长不一致 / 時間不一致', quiet: '音量低 / 音量が小さい' };
const flags = (r: AudioReviewItem) => audioReviewFlags({ measuredDuration: r.measuredDuration ?? undefined, reportedDuration: r.reportedDuration, meanDb: r.meanDb ?? undefined });

export function AudioReviewPanel({ repository, onClose, onAuthError }: { repository: AudioAdminRepository; onClose: () => void; onAuthError: (error: unknown) => void }) {
  const [items, setItems] = useState<AudioReviewItem[]>([]), [selected, setSelected] = useState<AudioReviewItem | null>(null);
  const [detail, setDetail] = useState<AudioDetail | null>(null), [samples, setSamples] = useState<Float32Array | null>(null);
  const [start, setStart] = useState(0), [end, setEnd] = useState(0), [window, setWindow] = useState<[number, number]>([0, 60]);
  const [only, setOnly] = useState(false), [date, setDate] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [scanning, setScanning] = useState(false), [progress, setProgress] = useState('');
  const [previewUrl, setPreviewUrl] = useState(''), [playhead, setPlayhead] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), wave = useRef<HTMLDivElement>(null), audio = useRef<HTMLAudioElement>(null);
  const alive = useRef(true), generation = useRef(0), stopScan = useRef(false), busy = useRef(false), retryKey = useRef<{ range: string; key: string } | null>(null);
  const duration = samples ? samples.length / 16000 : 0;
  function failure(cause: unknown) { const code = cause instanceof Error ? cause.message : ''; if (['AUTH_REQUIRED', 'ADMIN_REQUIRED', 'OPERATOR_REQUIRED'].includes(code)) onAuthError(cause); setError(code.includes('CONFLICT') ? '录音已被其他操作修改，请重新打开后再保存。 / 更新が競合しました。再読込してください。' : `操作失败 / 操作失敗 (${code || 'UNKNOWN'})`); }
  useEffect(() => { alive.current = true; repository.list().then(setItems).catch(failure); return () => { alive.current = false; generation.current++; stopScan.current = true; }; }, [repository]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { if (!samples) { setPreviewUrl(''); return; } try { setPreviewUrl(URL.createObjectURL(encodeAudioClip(samples, start, end))); } catch { setPreviewUrl(''); } }, [samples, start, end]);
  function patch(id: string, data: Partial<AudioReviewItem>) { setItems(previous => previous.map(r => r.id === id ? { ...r, ...data } : r)); }
  async function open(item: AudioReviewItem) {
    if (busy.current || scanning) return;
    const g = ++generation.current; audio.current?.pause(); setPreviewUrl(''); setPlayhead(0); setSelected(item); setSamples(null); setDetail(null); setLoading(true); setError(''); setNotice(''); retryKey.current = null;
    try {
      const d = await repository.detail(item.id), decoded = await decodeReviewAudio(d.originalUrl);
      if (!alive.current || g !== generation.current) return;
      const seconds = decoded.samples.length / 16000;
      const active = d.versions.find(v => v.id === d.activeVersionId);
      const first = active ? Math.min(active.start_seconds, seconds - .05) : 0;
      const last = active ? Math.min(active.end_seconds, seconds) : Math.min(60, seconds);
      setDetail(d); setSamples(decoded.samples); setStart(Math.max(0, first)); setEnd(last); setWindow([Math.max(0, first), last]); setPlayhead(0);
      await repository.measure(item.id, seconds, decoded.meanDb); patch(item.id, { measuredDuration: seconds, meanDb: decoded.meanDb, activeVersionId: d.activeVersionId, revision: d.revision });
    } catch (e) { if (g === generation.current && alive.current) failure(e); } finally { if (g === generation.current && alive.current) setLoading(false); }
  }
  async function scan() {
    if (busy.current || scanning) return; stopScan.current = false; setScanning(true); setError(''); let failed = 0;
    try { for (let i = 0; i < items.length; i++) {
      if (stopScan.current || !alive.current) break;
      setProgress(`${i + 1} / ${items.length}`); const r = items[i];
      try { const d = await repository.detail(r.id), decoded = await decodeReviewAudio(d.originalUrl); if (stopScan.current || !alive.current) break; await repository.measure(r.id, decoded.samples.length / 16000, decoded.meanDb); patch(r.id, { measuredDuration: decoded.samples.length / 16000, meanDb: decoded.meanDb }); }
      catch (e) { failed++; if (e instanceof Error && ['AUTH_REQUIRED', 'ADMIN_REQUIRED'].includes(e.message)) { failure(e); break; } }
    } } finally { if (alive.current) { setScanning(false); setNotice(`检查结束 / 検査終了 · 无法解析 / 解析失敗 ${failed}`); } }
  }
  useEffect(() => {
    const draw = () => {
      const c = canvas.current; if (!c) return;
      const rect = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = rect.width * dpr; c.height = rect.height * dpr;
      const ctx = c.getContext('2d'); if (!ctx) return; ctx.scale(dpr, dpr);
      if (!samples) return;
      const peaks = waveformPeaks(samples.subarray(Math.floor(window[0] * 16000), Math.ceil(window[1] * 16000)), Math.ceil(rect.width));
      ctx.strokeStyle = '#dce4e3'; for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(rect.width * i / 8, 0); ctx.lineTo(rect.width * i / 8, rect.height); ctx.stroke(); }
      const max = Math.max(.02, ...peaks); ctx.fillStyle = '#477e77';
      peaks.forEach((p, i) => { const h = Math.max(1, p / max * (rect.height - 28)); ctx.fillRect(i / peaks.length * rect.width, (rect.height - h) / 2, Math.max(1, rect.width / peaks.length), h); });
    };
    draw(); const observer = new ResizeObserver(draw); if (canvas.current) observer.observe(canvas.current); return () => observer.disconnect();
  }, [samples, window]);
  async function save(restore = false) {
    if (!selected || !detail || busy.current) return;
    if (!restore && (!samples || end <= start || end - start > 300)) return;
    if (!confirm(restore ? '恢复原版为主音频，并撤回已发布转写？ / 原音声に戻し文字公開を取り消しますか？' : '将选段设为访客主音频，并撤回已发布转写？原始录音会保留。 / 選択範囲を公開音声にしますか？原音声は保持されます。')) return;
    busy.current = true; setSaving(true); setError(''); setNotice(''); audio.current?.pause();
    try {
      if (restore) await repository.restore(selected.id, detail.revision);
      else {
        const range = `${selected.id}:${detail.revision}:${start}:${end}`;
        if (retryKey.current?.range !== range) retryKey.current = { range, key: crypto.randomUUID() };
        await repository.save({ recordingId: selected.id, revision: detail.revision, requestKey: retryKey.current.key, start, end, audio: encodeAudioClip(samples!, start, end) });
      }
      const updated = await repository.detail(selected.id); setDetail(updated); patch(selected.id, { activeVersionId: updated.activeVersionId, revision: updated.revision }); retryKey.current = null;
      setNotice('主音频已更新，原版已保留。 / 公開音声を更新しました。原音声は保持されています。');
    } catch (e) { failure(e); } finally { busy.current = false; setSaving(false); }
  }
  const position = (time: number) => (time - window[0]) / (window[1] - window[0]) * 100;
  const dates = [...new Set(items.map(r => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(r.createdAt))))].sort().reverse();
  const visible = items.filter(r => (!only || flags(r).length) && (!date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(r.createdAt)) === date));
  return <section className="audio-review" aria-label="录音审核 / 音声レビュー">
    <header className="ar-header"><button title="返回后台 / 戻る" onClick={onClose} disabled={saving}><ArrowLeft size={18} /></button><h1>录音审核与剪辑 / 音声レビュー</h1><button title="关闭 / 閉じる" onClick={onClose} disabled={saving}><X size={18} /></button></header>
    <div className="ar-body"><aside><div className="ar-filters"><label><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> 异常候选 / 要確認</label><select aria-label="日期 / 日付" value={date} onChange={e => setDate(e.target.value)}><option value="">全部日期 / 全日付</option>{dates.map(d => <option key={d}>{d}</option>)}</select></div>
      <button className="ar-scan" disabled={saving || loading} onClick={() => scanning ? stopScan.current = true : void scan()}><ScanLine size={16} />{scanning ? `停止 / 停止 ${progress}` : '检查全部 / 全件検査'}</button>
      <small>{visible.length} / {items.length}</small>{visible.map(r => <button className={`ar-record ${selected?.id === r.id ? 'active' : ''}`} key={r.id} disabled={saving || scanning} onClick={() => void open(r)}><strong>{r.label}</strong><small>{new Date(r.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} · {r.measuredDuration == null ? '未检查 / 未検査' : format(r.measuredDuration)}</small><span>{flags(r).map(f => labels[f]).join(' · ')}</span>{r.activeVersionId && <small className="ar-edited"><Check size={12} /> 已剪辑 / 編集済み</small>}</button>)}
    </aside><div className="ar-editor"><h2>{selected?.label ?? '选择录音 / 音声を選択'}</h2>{selected && <p className="ar-meta">{detail?.activeVersionId ? '当前主音频：剪辑版 / 公開：編集版' : '当前主音频：原版 / 公開：原音声'} · {duration ? format(duration) : '—'}</p>}
      {loading && <p role="status"><LoaderCircle size={16} /> 加载音频 / 読込中…</p>}
      <div className="ar-toolbar"><button title="试听选段 / 選択範囲を再生" disabled={!previewUrl || saving} onClick={() => { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(failure); } }}><Play size={17} /></button><button title="暂停 / 一時停止" onClick={() => audio.current?.pause()}><Pause size={17} /></button><button title="放大选段 / 選択範囲を拡大" disabled={!samples} onClick={() => setWindow([start, end])}><ZoomIn size={17} /></button><button title="完整波形 / 全体表示" disabled={!samples} onClick={() => setWindow([0, duration])}><ZoomOut size={17} /></button><button disabled={!samples} onClick={() => { setStart(0); setEnd(Math.min(60, duration)); setWindow([0, Math.min(60, duration)]); }}>前 1 分钟 / 最初の1分</button></div>
      <div className="ar-wave" ref={wave} onClick={e => { if (!audio.current || !samples) return; const rect = e.currentTarget.getBoundingClientRect(), t = window[0] + (e.clientX - rect.left) / rect.width * (window[1] - window[0]); if (t >= start && t <= end) audio.current.currentTime = t - start; }}><canvas ref={canvas} /><div className="ar-selection" style={{ left: `${Math.max(0, position(start))}%`, width: `${Math.max(0, position(Math.min(end, window[1])) - Math.max(0, position(start)))}%` }} />
        {samples && (['start', 'end'] as const).map(key => { const t = key === 'start' ? start : end; return <div key={key} role="slider" tabIndex={saving ? -1 : 0} aria-label={key === 'start' ? '剪辑起点 / 開始' : '剪辑终点 / 終了'} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={t} className="ar-handle" style={{ left: `${position(t)}%`, display: position(t) < 0 || position(t) > 100 ? 'none' : undefined }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (saving || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const value = t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : .1); key === 'start' ? setStart(Math.max(0, Math.min(end - .05, value))) : setEnd(Math.min(duration, Math.max(start + .05, value))); }} onPointerDown={e => { if (saving) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (saving || !e.currentTarget.hasPointerCapture(e.pointerId) || !wave.current) return; const rect = wave.current.getBoundingClientRect(), value = Math.max(window[0], Math.min(window[1], window[0] + (e.clientX - rect.left) / rect.width * (window[1] - window[0]))); key === 'start' ? setStart(Math.max(0, Math.min(end - .05, value))) : setEnd(Math.min(duration, Math.max(start + .05, value))); }}><span>⋮</span></div>; })}
        {samples && <div className="ar-playhead" style={{ left: `${position(start + playhead)}%` }} />}</div>
      <div className="ar-ticks">{Array.from({ length: 5 }, (_, i) => <span key={i}>{format(window[0] + (window[1] - window[0]) * i / 4)}</span>)}</div>
      <div className="ar-range"><label>起点 / 開始<input type="number" step="0.1" min={0} max={end - .05} value={Number(start.toFixed(2))} disabled={!samples || saving} onChange={e => setStart(Math.max(0, Math.min(end - .05, Number(e.target.value))))} /></label><label>终点 / 終了<input type="number" step="0.1" min={start + .05} max={duration} value={Number(end.toFixed(2))} disabled={!samples || saving} onChange={e => setEnd(Math.min(duration, Math.max(start + .05, Number(e.target.value))))} /></label><label>保留时长 / 保持<strong>{format(end - start)}</strong></label></div>
      <audio ref={audio} src={previewUrl || undefined} controls onTimeUpdate={e => setPlayhead(e.currentTarget.currentTime)} />
      <div className="ar-toolbar"><button className="ar-primary" disabled={!previewUrl || saving || loading || end - start > 300} onClick={() => void save()}><Save size={16} /> 保存为主音频 / 公開音声に保存</button><button disabled={!detail?.activeVersionId || saving || loading} onClick={() => void save(true)}><RotateCcw size={16} /> 恢复原版 / 原音声に戻す</button></div>
      {end - start > 300 && <p role="alert">选段不能超过5分钟 / 最大5分</p>}{error && <p role="alert" className="ar-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!!detail?.versions.length && <section className="ar-versions"><h3>剪辑版本 / 編集履歴</h3>{detail.versions.map(v => <div key={v.id}><strong>{format(v.duration)}</strong> · {new Date(v.created_at).toLocaleString()} {v.id === detail.activeVersionId && <span>主音频 / 公開中</span>}{v.url && <audio controls preload="none" src={v.url} />}</div>)}</section>}
    </div></div>
  </section>;
}
