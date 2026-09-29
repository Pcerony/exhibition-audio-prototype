import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Download, ExternalLink, FileUp, Plus, RotateCcw, Search, Tag as TagIcon, Upload } from 'lucide-react';
import type { Tag } from '../../domain/tags';
import type { TagRepository } from '../../storage/repository';
import { parseTagCsv, serializeTags } from './csv';
import { useI18n } from '../../i18n/I18nProvider';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import './admin.css';

type Props = { repository: TagRepository; baseUrl: string };

export function AdminPage({ repository, baseUrl }: Props) {
  const { locale, t } = useI18n();
  const siteBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const [tags, setTags] = useState<Tag[]>([]);
  const [label, setLabel] = useState('');
  const [batch, setBatch] = useState('');
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() { setTags(await repository.listTags()); }
  useEffect(() => { void refresh(); }, [repository]);

  async function addTag(tagLabel: string, tagBatch: string) {
    const token = crypto.randomUUID().replaceAll('-', '');
    await repository.createTag({ id: crypto.randomUUID(), token, label: tagLabel, batch: tagBatch });
  }

  async function createOne(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    if (tags.some((tag) => tag.label.toLocaleLowerCase() === label.trim().toLocaleLowerCase())) {
      setError(t('admin.createError'));
      setNotice('');
      return;
    }
    try {
      await addTag(label.trim(), batch.trim());
      setLabel('');
      setNotice(t('admin.createSuccess'));
      setError('');
      await refresh();
    } catch {
      setError(t('admin.createError'));
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const rows = parseTagCsv(await file.text());
      const existing = new Set(tags.map((tag) => tag.label.toLocaleLowerCase()));
      const duplicates = rows.filter((row) => existing.has(row.label.toLocaleLowerCase()));
      if (duplicates.length) throw new Error(`TAG_DUPLICATE:${duplicates.map((row) => row.label).join('、')}`);
      for (const row of rows) await addTag(row.label, row.batch);
      setNotice(t('admin.importSuccess', { count: rows.length }));
      setError('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith('TAG_DUPLICATE:')
        ? t('admin.importDuplicate', { labels: cause.message.slice('TAG_DUPLICATE:'.length) })
        : t('admin.csvError'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function reset(tag: Tag) {
    if (!window.confirm(t('admin.resetConfirm', { label: tag.label }))) return;
    await repository.resetTag(tag.token);
    setNotice(t('admin.resetSuccess', { label: tag.label }));
    await refresh();
  }

  function exportCsv() {
    const file = new Blob([`\uFEFF${serializeTags(tags, baseUrl, locale)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = locale === 'ja-JP' ? '展示タグ一覧.csv' : '展签清单.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visibleTags = tags.filter((tag) => `${tag.label} ${tag.batch} ${tag.recording?.nickname ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const boundCount = tags.filter((tag) => tag.recording).length;

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand"><span><AudioLines size={17} /></span><div><strong>{t('app.title')}</strong><small>{t('app.operator')}</small></div></div>
        <div className="admin-header-right"><LanguageSwitch /><span className="local-indicator"><i /> {t('app.localDemo')}</span><button className="icon-button" title={t('admin.export')} aria-label={t('admin.export')} onClick={exportCsv}><Download size={17} /></button></div>
      </header>
      <div className="admin-content">
        <div className="admin-title-row"><div><p className="admin-kicker">{t('admin.kicker')}</p><h1>{t('admin.title')}</h1></div><div className="admin-totals"><span>{t('admin.countTags', { count: tags.length })}</span><span>{t('admin.countRecordings', { count: boundCount })}</span></div></div>
        <section className="admin-toolbar" aria-label={t('admin.title')}>
          <form className="add-tag-form" onSubmit={createOne}>
            <label className="sr-only" htmlFor="tag-label">{t('admin.labelInput')}</label>
            <input id="tag-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('admin.labelPlaceholder')} />
            <label className="sr-only" htmlFor="tag-batch">{t('admin.batchInput')}</label>
            <input id="tag-batch" value={batch} onChange={(event) => setBatch(event.target.value)} placeholder={t('admin.batchPlaceholder')} />
            <button className="toolbar-primary" type="submit"><Plus size={16} /> {t('admin.add')}</button>
          </form>
          <input ref={fileRef} className="file-input" type="file" accept=".csv,text/csv" aria-label={t('admin.importFile')} onChange={(event) => void importFile(event.target.files?.[0])} />
          <button className="toolbar-secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('admin.import')}</button>
        </section>
        {(notice || error) && <p className={`admin-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
        <div className="table-controls"><div className="search-field"><Search size={16} /><input aria-label={t('admin.search')} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('admin.searchPlaceholder')} /></div><span>{t('admin.rowCount', { count: visibleTags.length })}</span></div>
        <section className="tag-table-wrap">
          <table className="tag-table">
            <thead><tr><th>{t('admin.columnTag')}</th><th>{t('admin.columnRecording')}</th><th>{t('admin.columnUrl')}</th><th>{t('admin.columnActions')}</th></tr></thead>
            <tbody>{visibleTags.map((tag) => <tr key={tag.id}>
              <td><div className="tag-label-cell"><span className="tag-glyph"><TagIcon size={15} /></span><span><strong>{tag.label}</strong><small>{tag.batch || t('admin.noBatch')}</small></span></div></td>
              <td>{tag.recording ? <div className="recording-status"><span className="status-dot bound" /><span><strong>{t('admin.bound')}</strong><small>{tag.recording.nickname || t('admin.noNickname')} · {formatDate(tag.recording.createdAt, locale)}</small></span></div> : <span className="recording-status"><span className="status-dot" />{t('admin.unbound')}</span>}</td>
              <td><div className="tag-url"><a href={`${siteBase}#/t/${tag.token}`} target="_blank" rel="noreferrer">{siteBase}#/t/{tag.token}<ExternalLink size={12} /></a><small>{t('admin.writeUrl')}</small></div></td>
              <td><div className="row-actions">{tag.recording && <><AudioPreview repository={repository} recordingId={tag.recording.id} label={t('admin.previewAudio')} loading={t('admin.audioLoading')} /><button className="row-icon-button" onClick={() => void reset(tag)} title={t('admin.reset')} aria-label={t('admin.reset')}><RotateCcw size={15} /></button></>}</div></td>
            </tr>)}</tbody>
          </table>
          {!visibleTags.length && <div className="empty-table"><FileUp size={20} /><p>{tags.length ? t('admin.emptyFiltered') : t('admin.empty')}</p><small>{t('admin.emptyHint')}</small></div>}
        </section>
        <div className="admin-footnote"><Check size={14} /> {t('app.localOnly')}</div>
      </div>
    </main>
  );
}

function AudioPreview({ repository, recordingId, label, loading }: { repository: TagRepository; recordingId: string; label: string; loading: string }) {
  const [url, setUrl] = useState('');
  const objectUrl = useRef('');
  useEffect(() => {
    let active = true;
    repository.getAudio(recordingId).then((blob) => {
      if (active && blob) {
        objectUrl.current = URL.createObjectURL(blob);
        setUrl(objectUrl.current);
      }
    });
    return () => {
      active = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = '';
    };
  }, [repository, recordingId]);
  return url ? <audio controls aria-label={label} src={url} /> : <span className="loading-audio">{loading}</span>;
}

function formatDate(value: string, locale: 'zh-CN' | 'ja-JP') {
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
