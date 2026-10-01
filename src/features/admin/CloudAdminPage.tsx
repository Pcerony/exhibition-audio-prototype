import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, LogOut, Play, Plus, RotateCcw, Search, Shield, Power, Wrench, History } from 'lucide-react';
import type { AdminRepository, AuditEntry, ManagedTag, OperatorSession, ProvisioningJob, TagQuery } from '../../storage/adminRepository';
import { useI18n } from '../../i18n/I18nProvider';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { parseTagCsv } from './csv';
import { cloudAdminMessages } from './cloudAdminMessages';
import './admin.css';
import './cloud-admin.css';

type Props = { repository: AdminRepository; baseUrl: string };
type BatchRequest = { rows: { label: string; batch: string }[]; key: string };
const PAGE_SIZE = 50;
function csv(rows: (string | number)[][]) {
  return rows.map((row) => row.map((value) => {
    const safe = /^[=+@-]/.test(String(value)) ? `'${value}` : String(value);
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
function download(rows: (string | number)[][], name: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv(rows)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}
export function CloudAdminPage({ repository, baseUrl }: Props) {
  const { locale } = useI18n(); const m = cloudAdminMessages[locale];
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [checking, setChecking] = useState(true); const [roleError, setRoleError] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [tags, setTags] = useState<ManagedTag[]>([]); const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<TagQuery['status']>(); const [offset, setOffset] = useState(0);
  const [label, setLabel] = useState(''); const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(false); const [notice, setNotice] = useState('');
  const [errorKind, setErrorKind] = useState<'error' | 'loginError' | 'authError' | 'operatorError'>('error');
  const [pending, setPending] = useState<BatchRequest | null>(null); const [revision, setRevision] = useState(0);
  const [jobs, setJobs] = useState<ProvisioningJob[] | null>(null); const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null); const file = useRef<HTMLInputElement>(null);
  const visitorUrl = (tag: ManagedTag) => tag.provisioning?.visitorUrl ?? `${baseUrl.replace(/\/$/, '')}/#/t/${tag.token}`;
  function clearProtectedData() { setSession(null); setTags([]); setTotal(0); setJobs(null); setAudit(null); setAudio(null); setPending(null); setOffset(0); }
  function handleFailure(cause: unknown) {
    const code = cause instanceof Error ? cause.message : '';
    setError(true);
    if (code === 'AUTH_REQUIRED' || code === 'OPERATOR_REQUIRED') {
      clearProtectedData(); setRoleError(true); setErrorKind(code === 'AUTH_REQUIRED' ? 'authError' : 'operatorError');
    } else { setErrorKind(code === 'LOGIN_FAILED' ? 'loginError' : 'error'); }
  }
  useEffect(() => { let active = true; setChecking(true); repository.getSession().then((value) => { if (active) setSession(value); }).catch((cause) => { if (active) handleFailure(cause); }).finally(() => { if (active) setChecking(false); }); return () => { active = false; }; }, [repository]);
  useEffect(() => {
    if (!session) return; let active = true; setLoading(true); setTags([]);
    repository.listTags({ search, status, offset, limit: PAGE_SIZE }).then((result) => { if (active) { setTags(result.tags); setTotal(result.total); } }).catch((cause) => { if (active) { setTags([]); setTotal(0); handleFailure(cause); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repository, session, search, status, offset, revision]);
  async function run(operation: () => Promise<void>) { if (busy) return; setBusy(true); setError(false); setErrorKind('error'); setNotice(''); try { await operation(); } catch (cause) { handleFailure(cause); } finally { setBusy(false); } }
  async function submitBatch(request: BatchRequest) { setPending(request); await repository.createBatch(request.rows, request.key); setPending(null); setLabel(''); setNotice(m.done); setRevision((v) => v + 1); }
  async function importFile(input?: File) { if (!input) return; await run(async () => { const rows = parseTagCsv(await input.text()); if (rows.length > 500) throw new Error('BATCH_LIMIT'); await submitBatch({ rows, key: crypto.randomUUID() }); }); if (file.current) file.current.value = ''; }
  async function exportTags() {
    const all: ManagedTag[] = []; let cursor = 0;
    while (true) { const result = await repository.listTags({ offset: cursor, limit: PAGE_SIZE }); all.push(...result.tags); cursor += result.tags.length; if (cursor >= result.total) break; if (!result.tags.length) throw new Error('INCOMPLETE_EXPORT'); }
    download([[m.label, m.batch, m.url, m.recording, m.write], ...all.map((tag) => [tag.label, tag.batch, visitorUrl(tag), tag.status ?? (tag.recording ? 'bound' : 'unbound'), tag.provisioning?.status ?? 'pending'])], 'tags.csv');
  }
  function iconButton(name: string, icon: React.ReactNode, action: () => void) { return <button type="button" disabled={busy} className="icon-button" title={name} aria-label={name} onClick={action}>{icon}</button>; }
  const logout = () => void run(async () => { await repository.signOut(); setSession(null); setRoleError(false); setTags([]); setJobs(null); setAudit(null); setAudio(null); setPending(null); });
  return <main className="admin-shell cloud-admin">
    <header className="admin-header"><div className="admin-brand"><Shield size={20} /><strong>{m.title}</strong></div><div className="admin-header-right"><LanguageSwitch />{(session || roleError) && iconButton(m.logout, <LogOut size={18} />, logout)}</div></header>
    {error && <p className="admin-message error" role="alert">{m[errorKind]}</p>}{notice && <p className="admin-message" role="status">{notice}</p>}
    {checking ? <p role="status">{m.loading}</p> : !session ? <section className="cloud-login">{roleError && <p>{m.role}</p>}<h1>{m.login}</h1><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const value = await repository.signIn(email, password); setSession(value); setPassword(''); setRoleError(false); }); }}><label>{m.email}<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>{m.password}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="toolbar-primary" disabled={busy}>{m.login}</button></form></section> : <div className="admin-content">
      <div className="admin-title-row"><h1>{m.title}</h1><span>{total}</span><div className="row-actions">{iconButton(m.export, <Download size={18} />, () => void run(exportTags))}{iconButton(m.jobs, <FileUp size={18} />, () => void run(async () => setJobs(await repository.listJobs())))}{iconButton(m.audit, <History size={18} />, () => void run(async () => setAudit(await repository.getAudit())))}{iconButton(m.maintenance, <Wrench size={18} />, () => { if (confirm(m.confirm)) void run(async () => { const result = await repository.maintenance(); setNotice(`${m.cleanup}: ${result.removed} / ${result.pending}`); }); })}</div></div>
      <section className="admin-toolbar"><form className="add-tag-form" onSubmit={(event) => { event.preventDefault(); if (label.trim()) void run(() => submitBatch({ rows: [{ label: label.trim(), batch: batch.trim() }], key: crypto.randomUUID() })); }}><input aria-label={m.label} placeholder={m.label} required value={label} disabled={busy || !!pending} onChange={(event) => setLabel(event.target.value)} /><input aria-label={m.batch} placeholder={m.batch} value={batch} disabled={busy || !!pending} onChange={(event) => setBatch(event.target.value)} /><button className="toolbar-primary" disabled={busy || !!pending}><Plus size={16} />{m.add}</button></form><input className="file-input" ref={file} aria-label={m.import} type="file" accept=".csv,text/csv" disabled={busy || !!pending} onChange={(event) => void importFile(event.target.files?.[0])} /><button className="toolbar-secondary" disabled={busy || !!pending} onClick={() => file.current?.click()}><FileUp size={16} />{m.import}</button>{pending && <button disabled={busy} onClick={() => void run(() => submitBatch(pending))}>{m.retry}</button>}</section>
      {pending && <button className="toolbar-secondary cloud-cancel" disabled={busy} onClick={() => { if (confirm(m.cancelConfirm)) { setPending(null); setError(false); setRevision((value) => value + 1); } }}>{m.cancelPending}</button>}
      <div className="table-controls"><div className="search-field"><Search size={16} /><input aria-label={m.search} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></div><select aria-label={m.recording} value={status ?? ''} onChange={(event) => { setStatus((event.target.value || undefined) as TagQuery['status']); setOffset(0); }}><option value="">{m.all}</option>{(['unbound', 'bound', 'disabled'] as const).map((value) => <option key={value} value={value}>{m[value]}</option>)}</select></div>
      {loading && <p role="status">{m.loading}</p>}<section className="tag-table-wrap"><table className="tag-table"><thead><tr><th>{m.label}</th><th>{m.recording}</th><th>{m.url}</th><th>{m.write}</th><th>{m.actions}</th></tr></thead><tbody>{tags.map((tag) => <tr key={tag.id}><td><strong>{tag.label}</strong><small>{tag.batch}</small></td><td>{m[tag.status ?? (tag.recording ? 'bound' : 'unbound')]}<small>{tag.recording?.nickname}</small></td><td className="tag-url"><a href={visitorUrl(tag)} target="_blank" rel="noreferrer">{visitorUrl(tag)}</a></td><td>{m[tag.provisioning?.status ?? 'pending']}</td><td><div className="row-actions">{tag.recording && <>{iconButton(m.preview, <Play size={16} />, () => void run(async () => { setAudio(null); setAudio({ id: tag.id, url: await repository.getPlaybackUrl(tag.recording!.id) }); }))}{iconButton(m.reset, <RotateCcw size={16} />, () => { if (confirm(`${tag.label}: ${m.confirm}`)) void run(async () => { await repository.resetTag(tag.id); setAudio(null); setRevision((v) => v + 1); }); })}</>}{iconButton(tag.status === 'disabled' ? m.enable : m.disable, <Power size={16} />, () => { if (confirm(`${tag.label}: ${m.confirm}`)) void run(async () => { await repository.setEnabled(tag.id, tag.status === 'disabled'); setRevision((v) => v + 1); }); })}</div>{audio?.id === tag.id && <audio controls autoPlay src={audio.url} aria-label={m.preview} onError={() => { setAudio(null); setError(true); }} />}</td></tr>)}</tbody></table>{!loading && !tags.length && <p className="empty-table">{m.empty}</p>}</section>
      <nav className="cloud-pagination" aria-label={m.title}><button disabled={loading || busy || offset === 0} onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}>{m.previous}</button><span>{total ? offset + 1 : 0}–{Math.min(offset + tags.length, total)} / {total}</span><button disabled={loading || busy || offset + PAGE_SIZE >= total} onClick={() => setOffset((v) => v + PAGE_SIZE)}>{m.next}</button></nav>
      {jobs && <section className="cloud-details"><h2>{m.jobs}</h2><p>{m.nfc}</p><button disabled={busy} onClick={() => download([['id', 'tagId', 'label', 'batch', 'visitorUrl', 'version', 'status', 'errorCode'], ...jobs.map((job) => [job.id, job.tagId, job.label, job.batch, job.visitorUrl, job.version, job.status, job.errorCode ?? ''])], 'provisioning-jobs.csv')}><Download size={16} />{m.exportJobs}</button><button onClick={() => setJobs(null)}>{m.close}</button><ul>{jobs.map((job) => <li key={job.id}>{job.label} · {job.batch} · {m[job.status]}</li>)}</ul></section>}
      {audit && <section className="cloud-details"><h2>{m.audit}</h2><button onClick={() => setAudit(null)}>{m.close}</button><ul>{audit.map((entry) => <li key={entry.id}>{entry.createdAt} · {entry.action} · {entry.operatorId} · {entry.tagId}</li>)}</ul></section>}
    </div>}
  </main>;
}
