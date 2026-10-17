import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { memoryLocationUrl } from '../../domain/location';
import { MEMORY_CATEGORIES } from '../../domain/classification';
import {
  Download,
  FileUp,
  LogOut,
  Play,
  Plus,
  Search,
  Shield,
  Power,
  Wrench,
  History,
  Trash2,
  RotateCcw,
  X,
  FileText,
  MapPin,
  RefreshCw,
  QrCode,
} from "lucide-react";
import { MAP_PIECE_VERSION } from '../../domain/mapPieceVersion';
import { MAP_PIECE_CODES } from '../../domain/mapPieceCodes';
const MapPieceMap = lazy(() => import('./MapPieceMap').then((module) => ({ default: module.MapPieceMap })));
import type {
  AdminTranscriptionState,
  AdminRepository,
  AuditEntry,
  ManagedTag,
  OperatorSession,
  ProvisioningJob,
  TagQuery,
  BulkGroup,
  BulkApply,
} from "../../storage/adminRepository";
import { clearQrFallbackSession } from "../../storage/qrHistoryStorage";
import { useOperatorI18n as useI18n } from "../../i18n/I18nProvider";
import { LanguageSwitch } from "../../i18n/LanguageSwitch";
import { cloudAdminMessages } from "./cloudAdminMessages";
import { operatorMessages } from "./operatorMessages";
import { OperatorDialog } from "./OperatorDialog";
import { TranscriptionDialog } from './TranscriptionDialog';
import { transcriptionMessages } from './transcriptionMessages';
import "./admin.css";
import "./cloud-admin.css";
type Props = { repository: AdminRepository; baseUrl: string };
type CreateRequest = { count: number; key: string };
type BulkDialog = {
  operation: "reset" | "delete";
  ids: string[];
  groups: BulkGroup[];
  index: number;
  requestKey: string;
};
const PAGE_SIZE = 50;
function transcriptionListState(recording: ManagedTag['recording']): AdminTranscriptionState | null {
  if (!recording) return null;
  const summary = recording.transcriptionSummary;
  if (!summary?.consented) return 'not_consented';
  if (summary.status === 'processing') return 'processing';
  if (summary.status === 'ready') return summary.published ? 'published' : 'draft';
  if (summary.status === 'failed') return 'failed';
  return 'pending';
}
function download(rows: (string | number)[][], name: string) {
  const content = rows
    .map((row) =>
      row
        .map((value) => {
          const raw = String(value);
          const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function CloudAdminPage({ repository, baseUrl }: Props) {
  const { locale } = useI18n();
  const m = cloudAdminMessages[locale];
  const n = operatorMessages[locale];
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [roleError, setRoleError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const categories = MEMORY_CATEGORIES.map((category) => ({
    ...category,
    name: n.categoryNames[category.code],
  }));
  const [batchDate, setBatchDate] = useState("");
  const [count, setCount] = useState(1);
  const [pending, setPending] = useState<CreateRequest | null>(null);
  const [tags, setTags] = useState<ManagedTag[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TagQuery["status"]>();
  const [transcriptionState, setTranscriptionState] = useState<TagQuery['transcriptionState']>();
  const [pieceCode, setPieceCode] = useState<TagQuery['pieceCode']>();
  const [sort, setSort] = useState<TagQuery["sort"]>("recorded_desc");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [transcription, setTranscription] = useState<{ recordingId: string; label: string } | null>(null);
  const [jobs, setJobs] = useState<ProvisioningJob[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [bulk, setBulk] = useState<BulkDialog | null>(null);
  const [ack, setAck] = useState(false);
  const [stale, setStale] = useState(false);
  const [activeMapRecordingId, setActiveMapRecordingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState<ManagedTag | null>(null);
  const [correctionChoice, setCorrectionChoice] = useState('needs_review');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionStale, setCorrectionStale] = useState(false);
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const visitorUrl = (tag: ManagedTag) =>
    tag.provisioning?.visitorUrl ??
    `${baseUrl.replace(/\/$/, "")}/#/t/${tag.token}`;
  function clear() {
    setSession(null);
    setTags([]);
    setTotal(0);
    setSelected([]);
    setPending(null);
    setBulk(null);
    setJobs(null);
    setAudit(null);
    setAudio(null);
    setTranscription(null);
    setPieceCode(undefined);
    setActiveMapRecordingId(null);
    setCorrection(null);
    setCorrectionStale(false);
  }
  function failure(cause: unknown) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "AUTH_REQUIRED" || code === "OPERATOR_REQUIRED") {
      clearQrFallbackSession(session?.userId);
      clear();
      setRoleError(true);
      setError(code === "AUTH_REQUIRED" ? m.authError : m.operatorError);
    } else if (
      [
        "STALE_PREVIEW",
        "VERSION_CONFLICT",
        "GROUP_CONFLICT",
        "GROUP_CHANGED",
        "CARD_VERSION_CONFLICT",
        "BULK_CONFLICT",
      ].includes(code)
    ) {
      setStale(true);
      setError(n.stale);
    } else setError(code === "LOGIN_FAILED" ? m.loginError : m.error);
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      failure(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    repository
      .getSession()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((cause) => {
        if (active) failure(cause);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [repository]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setTags([]);
    setAudio(null);
    setSelected([]);
    repository
      .listTags({
        search,
        status,
        ...(transcriptionState ? { transcriptionState } : {}),
        ...(pieceCode ? { pieceCode } : {}),
        batchDate: batchDate || undefined,
        sort,
        offset,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        if (active) {
          setTags(result.tags);
          setTotal(result.total);
        }
      })
      .catch((cause) => {
        if (active) {
          setTags([]);
          setTotal(0);
          failure(cause);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repository, session, search, status, transcriptionState, pieceCode, batchDate, sort, offset, revision]);
  const refresh = () => setRevision((v) => v + 1);
  async function create(request: CreateRequest) {
    setPending(request);
    await repository.createCards(
      request.count,
      request.key,
    );
    setPending(null);
    setNotice(m.done);
    refresh();
  }
  async function preview(
    operation: BulkDialog["operation"],
    ids = selected,
  ) {
    const result = await repository.previewBulk(
      ids,
      operation,
    );
    const groups = result.groups.filter((group) => group.cards.length);
    if (!groups.length) {
      setBulk(null);
      setSelected([]);
      refresh();
      return;
    }
    setBulk({
      operation,
      ids,
      groups,
      index: 0,
      requestKey: crypto.randomUUID(),
    });
    setAck(false);
    setStale(false);
  }
  function advance() {
    setAck(false);
    setStale(false);
    setError("");
    if (!bulk) return;
    if (bulk.index + 1 < bulk.groups.length)
      setBulk({
        ...bulk,
        ids: bulk.groups.slice(bulk.index + 1).flatMap((group) => group.cards.map((card) => card.id)),
        index: bulk.index + 1,
        requestKey: crypto.randomUUID(),
      });
    else {
      setBulk(null);
      setSelected([]);
      refresh();
    }
  }
  async function apply() {
    if (!bulk) return;
    const group = bulk.groups[bulk.index];
    const request: BulkApply = {
      operation: bulk.operation,
      cards: group.cards.map((card) => ({
        id: card.id,
        version: card.version,
        label: card.label,
      })),
      kind: group.kind,
      requestKey: bulk.requestKey,
    };
    await repository.applyBulk(request);
    advance();
    setAudio(null);
  }
  async function exportTags() {
    const all: ManagedTag[] = [];
    let cursor = 0;
    while (true) {
      const result = await repository.listTags({
        offset: cursor,
        limit: PAGE_SIZE,
      });
      all.push(...result.tags);
      cursor += result.tags.length;
      if (cursor >= result.total) break;
      if (!result.tags.length) throw new Error("INCOMPLETE_EXPORT");
    }
    download(
      [
        [m.label, n.inventory, n.categories, n.batchDate, n.legacyBatch, m.url, m.recording, m.write, n.recordedAt],
        ...all.map((tag) => [
          tag.serialNumber ?? tag.label,
          tag.inventoryLabel ?? "",
          categories.find((category) => category.id === tag.categoryId)?.name ?? n.uncategorized,
          tag.batchDate ?? "",
          tag.batchDate ? "" : tag.batch,
          visitorUrl(tag),
          tag.status ?? (tag.recording ? "bound" : "unbound"),
          tag.entryChannel === 'qr' && !tag.provisioning ? m.qrOnly : tag.provisioning?.status ?? "pending",
          tag.recording?.createdAt ?? "",
        ]),
      ],
      "tags.csv",
    );
  }
  function openPieceCorrection(tag: ManagedTag) {
    const assignment = tag.recording?.pieceAssignment;
    if (!tag.recording || !assignment) return;
    setCorrection(tag);
    setCorrectionChoice(assignment.pieceCode ? `piece:${assignment.pieceCode}`
      : assignment.state === 'outside_map' ? 'outside_map' : 'needs_review');
    setCorrectionError('');
    setCorrectionStale(false);
  }
  async function savePieceCorrection() {
    const recording = correction?.recording;
    const assignment = recording?.pieceAssignment;
    if (!recording || !assignment || correctionSaving) return;
    const state = correctionChoice.startsWith('piece:') ? 'assigned'
      : correctionChoice === 'outside_map' ? 'outside_map' : 'needs_review';
    const nextPieceCode = state === 'assigned' ? correctionChoice.slice('piece:'.length) : null;
    setCorrectionSaving(true);
    setCorrectionError('');
    setCorrectionStale(false);
    try {
      await repository.setPieceAssignment({
        recordingId: recording.id, expectedVersion: assignment.version, state,
        pieceCode: nextPieceCode, mapVersion: MAP_PIECE_VERSION,
      });
      setActiveMapRecordingId(recording.id);
      setCorrection(null);
      refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'AUTH_REQUIRED' || code === 'OPERATOR_REQUIRED') {
        setCorrection(null);
        failure(cause);
      } else {
        setCorrectionStale(code === 'VERSION_CONFLICT');
        setCorrectionError(code === 'VERSION_CONFLICT' ? m.pieceConflict : m.pieceUnavailable);
      }
    } finally {
      setCorrectionSaving(false);
    }
  }
  function icon(name: string, element: React.ReactNode, action: () => void) {
    return (
      <button
        type="button"
        className="icon-button"
        disabled={busy || !!bulk}
        title={name}
        aria-label={name}
        onClick={action}
      >
        {element}
      </button>
    );
  }
  const group = bulk?.groups[bulk.index];
  const activeMapRecording = tags.find((tag) => tag.recording?.id === activeMapRecordingId)?.recording;
  const highlightedPiece = activeMapRecording?.pieceAssignment?.pieceCode ?? null;
  return (
    <main className="admin-shell cloud-admin">
      <header className="admin-header">
        <div className="admin-brand">
          <Shield size={20} />
          <strong>{m.title}</strong>
        </div>
        <div className="admin-header-right">
          <LanguageSwitch />
          {session && <a className="icon-button" href="#/admin/qr" aria-label={m.qrFallback} title={m.qrFallback}><QrCode size={18} /></a>}
          {(session || roleError) &&
            icon(
              m.logout,
              <LogOut size={18} />,
              () =>
                void run(async () => {
                  await repository.signOut();
                  clearQrFallbackSession(session?.userId);
                  clear();
                  setRoleError(false);
                }),
            )}
        </div>
      </header>
      {error && !bulk && (
        <p className="admin-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-message" role="status">
          {notice}
        </p>
      )}
      {checking ? (
        <p role="status">{m.loading}</p>
      ) : !session ? (
        <section className="cloud-login">
          <h1>{m.login}</h1>
          {roleError && <p>{m.role}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setSession(await repository.signIn(email, password));
                setPassword("");
                setRoleError(false);
              });
            }}
          >
            <label>
              {m.email}
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {m.password}
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={busy} className="toolbar-primary">
              {m.login}
            </button>
          </form>
        </section>
      ) : (
        <div className="operator-layout">
          <div className="admin-content">
            <div className="admin-title-row">
              <h1>{m.title}</h1>
              <span>{total}</span>
              <div className="row-actions">
                {icon(
                  m.export,
                  <Download size={18} />,
                  () => void run(exportTags),
                )}
                {icon(
                  m.jobs,
                  <FileUp size={18} />,
                  () =>
                    void run(async () => setJobs(await repository.listJobs())),
                )}
                {icon(
                  m.audit,
                  <History size={18} />,
                  () =>
                    void run(async () => setAudit(await repository.getAudit())),
                )}
                {icon(m.maintenance, <Wrench size={18} />, () => {
                  if (confirm(m.confirm))
                    void run(async () => {
                      const result = await repository.maintenance();
                      setNotice(
                        `${m.cleanup}: ${result.removed} / ${result.pending}`,
                      );
                    });
                })}
              </div>
            </div>
            <section className="operator-create">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() =>
                    create({ count, key: crypto.randomUUID() }),
                  );
                }}
              >
                <label className="card-count">
                  {n.count}
                  <input
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={count}
                    disabled={busy || !!pending}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <button
                  className="toolbar-primary"
                  disabled={busy || !!pending}
                >
                  <Plus size={17} />
                  {n.create}
                </button>
              </form>
              {pending && (
                <div className="pending-actions">
                  <button
                    disabled={busy}
                    onClick={() => void run(() => create(pending))}
                  >
                    {m.retry}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm(m.cancelConfirm)) {
                        setPending(null);
                        setError("");
                        refresh();
                      }
                    }}
                  >
                    {m.cancelPending}
                  </button>
                </div>
              )}
            </section>
            <section ref={mapSectionRef} className="piece-map-section" aria-labelledby="piece-map-heading">
              <div className="piece-map-copy">
                <div>
                  <h2 id="piece-map-heading">{m.mapTitle}</h2>
                  <p>{m.mapHint}</p>
                </div>
                {pieceCode && <button type="button" className="piece-map-clear" onClick={() => { setPieceCode(undefined); setOffset(0); }} title={m.mapClear} aria-label={m.mapClear}><X size={17}/></button>}
              </div>
              <div className="piece-map-viewport">
                <Suspense fallback={<p role="status">{m.loading}</p>}>
                  <MapPieceMap
                    ariaLabel={`${m.mapTitle} (${MAP_PIECE_CODES.length})`}
                    selectedPiece={pieceCode}
                    highlightedPiece={highlightedPiece}
                    onSelect={(next) => { setPieceCode((current) => current === next ? undefined : next); setActiveMapRecordingId(null); setOffset(0); }}
                  />
                </Suspense>
              </div>
              {pieceCode && <p className="piece-map-filter-state" role="status">{m.pieceColumn}: {pieceCode}</p>}
            </section>
            <div className="table-controls">
              <label className="batch-date-filter">
                {n.batchDate}
                <input
                  type="date"
                  value={batchDate}
                  disabled={!!bulk}
                  onChange={(e) => {
                    setBatchDate(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label={m.search}
                  value={search}
                  disabled={!!bulk}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              </div>
              <select
                aria-label={m.recording}
                value={status ?? ""}
                disabled={!!bulk}
                onChange={(e) => {
                  setStatus(
                    (e.target.value || undefined) as TagQuery["status"],
                  );
                  setOffset(0);
                }}
              >
                <option value="">{m.all}</option>
                {(["unbound", "bound", "disabled"] as const).map((value) => (
                  <option value={value} key={value}>
                    {m[value]}
                  </option>
                ))}
              </select>
              <select
                aria-label={m.transcriptionFilter}
                value={transcriptionState ?? ""}
                disabled={!!bulk}
                onChange={(e) => {
                  setTranscriptionState((e.target.value || undefined) as TagQuery['transcriptionState']);
                  setOffset(0);
                }}
              >
                <option value="">{m.all}</option>
                <option value="not_consented">{m.transcriptionNotConsented}</option>
                <option value="pending">{m.transcriptionPending}</option>
                <option value="processing">{m.transcriptionProcessing}</option>
                <option value="draft">{m.transcriptionDraft}</option>
                <option value="published">{m.transcriptionPublished}</option>
                <option value="failed">{m.transcriptionFailed}</option>
              </select>
              <select
                aria-label={n.sort}
                value={sort}
                disabled={!!bulk}
                onChange={(e) => {
                  setSort(e.target.value as TagQuery["sort"]);
                  setOffset(0);
                }}
              >
                <option value="recorded_desc">{n.newest}</option>
                <option value="recorded_asc">{n.oldest}</option>
                <option value="number">{n.number}</option>
              </select>
            </div>
            <div className="bulk-toolbar">
              <span>
                {n.selected}: {selected.length}
              </span>
              <button
                disabled={!selected.length || busy || !!bulk}
                onClick={() => void run(() => preview("reset"))}
              >
                <RotateCcw size={16} />
                {n.reset}
              </button>
              <button
                className="danger-text"
                disabled={!selected.length || busy || !!bulk}
                onClick={() => void run(() => preview("delete"))}
              >
                <Trash2 size={16} />
                {n.delete}
              </button>
            </div>
            {loading && <p role="status">{m.loading}</p>}
            <section className="tag-table-wrap">
              <table className="tag-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label={n.selectPage}
                        disabled={!tags.length || busy || !!bulk}
                        checked={
                          !!tags.length && selected.length === tags.length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? tags.map((tag) => tag.id) : [],
                          )
                        }
                      />
                    </th>
                    <th>{m.label}</th>
                    <th>{m.recording}</th>
                    <th>{m.transcriptionFilter}</th>
                    <th>{m.pieceColumn}</th>
                    <th>{n.recordedAt}</th>
                    <th>{m.write}</th>
                    <th>{m.url}</th>
                    <th>{m.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => {
                    const rowTranscriptionState = transcriptionListState(tag.recording);
                    const rowTranscriptionLabel = rowTranscriptionState ? {
                      not_consented: m.transcriptionNotConsented,
                      pending: m.transcriptionPending,
                      processing: m.transcriptionProcessing,
                      draft: m.transcriptionDraft,
                      published: m.transcriptionPublished,
                      failed: m.transcriptionFailed,
                    }[rowTranscriptionState] : '—';
                    const pieceAssignment = tag.recording?.pieceAssignment;
                    const pieceAssignmentLabel = pieceAssignment?.state === 'not_applicable' ? m.pieceNotApplicable
                      : pieceAssignment?.state === 'pending' ? m.piecePending
                      : pieceAssignment?.state === 'assigned' ? m.pieceAssigned
                      : pieceAssignment?.state === 'needs_review' ? m.pieceReview
                      : pieceAssignment?.state === 'outside_map' ? m.pieceOutside : '—';
                    return <tr key={tag.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${n.select} ${tag.label}`}
                          disabled={busy || !!bulk}
                          checked={selected.includes(tag.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, tag.id]
                                : selected.filter((id) => id !== tag.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>{tag.serialNumber ?? tag.label}</strong>
                        {tag.inventoryLabel && tag.inventoryLabel !== tag.label && <small title={n.inventory}>{tag.inventoryLabel}</small>}
                        {tag.categoryId && <small>{categories.find((category) => category.id === tag.categoryId)?.name ?? tag.categoryCode}</small>}
                        {tag.batchDate ? <small title={n.batchDate}>{tag.batchDate}</small> : tag.batch && <small>{n.legacyBatch}: {tag.batch}</small>}
                      </td>
                      <td>
                        <span
                          className={`recording-badge ${tag.recording ? "bound" : ""}`}
                        >
                          {
                            m[
                              tag.status ??
                                (tag.recording ? "bound" : "unbound")
                            ]
                          }
                        </span>
                        <small>{tag.recording?.nickname}</small>
                        {tag.recording?.location && <a href={memoryLocationUrl(tag.recording.location)!} target="_blank" rel="noreferrer">{locale === 'ja-JP' ? '思い出の場所' : '回忆地点'}</a>}
                      </td>
                      <td className="transcription-status-cell">
                        {rowTranscriptionState
                          ? <span className={`transcription-status state-${rowTranscriptionState}`}>{rowTranscriptionLabel}</span>
                          : '—'}
                      </td>
                      <td className="piece-assignment-cell">
                        {pieceAssignment ? <>
                          <div className="piece-assignment-line">
                            <button type="button" className="piece-focus-button" disabled={!pieceAssignment.pieceCode} aria-label={`${m.mapTitle} ${pieceAssignment.pieceCode ?? ''} ${tag.serialNumber ?? tag.label}`} onClick={() => {
                              setActiveMapRecordingId(tag.recording!.id);
                              mapSectionRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                            }}>
                              <MapPin size={14}/><strong>{pieceAssignment.pieceCode ?? '—'}</strong>
                            </button>
                            <span>{pieceAssignmentLabel}</span>
                          </div>
                          {pieceAssignment.source && <small>{pieceAssignment.source === 'manual' ? m.pieceManual : m.pieceAutomatic}</small>}
                          {tag.recording && <button type="button" className="piece-edit-button" disabled={busy || !!bulk} aria-label={`${m.pieceEdit} ${tag.serialNumber ?? tag.label}`} onClick={() => openPieceCorrection(tag)}>{m.pieceEdit}</button>}
                        </> : '—'}
                      </td>
                      <td className="time-cell">
                        {tag.recording
                          ? new Date(tag.recording.createdAt).toLocaleString(
                              locale,
                            )
                          : "—"}
                      </td>
                      <td>{tag.entryChannel === 'qr' && !tag.provisioning ? m.qrOnly : m[tag.provisioning?.status ?? "pending"]}</td>
                      <td className="tag-url">
                        <a
                          href={visitorUrl(tag)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.url}
                        </a>
                      </td>
                      <td>
                        <div className="row-actions">
                          {tag.recording && (
                            <>
                              {icon(
                                m.preview,
                                <Play size={16} />,
                                () =>
                                  void run(async () => {
                                    setAudio(null);
                                    setAudio({
                                      id: tag.id,
                                      url: await repository.getPlaybackUrl(
                                        tag.recording!.id,
                                      ),
                                    });
                                  }),
                              )}
                              {icon(
                                transcriptionMessages[locale].title,
                                <FileText size={16} />,
                                () => setTranscription({ recordingId: tag.recording!.id, label: tag.serialNumber ?? tag.label }),
                              )}
                              {icon(
                                m.reset,
                                <RotateCcw size={16} />,
                                () =>
                                  void run(() => preview("reset", [tag.id])),
                              )}
                            </>
                          )}
                          {icon(
                            tag.status === "disabled" ? m.enable : m.disable,
                            <Power size={16} />,
                            () => {
                              if (confirm(`${tag.label}: ${m.confirm}`))
                                void run(async () => {
                                  await repository.setEnabled(
                                    tag.id,
                                    tag.status === "disabled",
                                  );
                                  refresh();
                                });
                            },
                          )}
                        </div>
                        {audio?.id === tag.id && (
                          <audio
                            controls
                            autoPlay
                            src={audio.url}
                            aria-label={m.preview}
                            onError={() => {
                              setAudio(null);
                              setError(m.error);
                            }}
                          />
                        )}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {!loading && !tags.length && (
                <p className="empty-table">{m.empty}</p>
              )}
            </section>
            <nav className="cloud-pagination" aria-label={m.title}>
              <button
                disabled={loading || busy || !!bulk || offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              >
                {m.previous}
              </button>
              <span>
                {total ? offset + 1 : 0}–{Math.min(offset + tags.length, total)}{" "}
                / {total}
              </span>
              <button
                disabled={
                  loading || busy || !!bulk || offset + PAGE_SIZE >= total
                }
                onClick={() => setOffset((v) => v + PAGE_SIZE)}
              >
                {m.next}
              </button>
            </nav>
            {jobs && (
              <section className="cloud-details">
                <h2>{m.jobs}</h2>
                <p>{m.nfc}</p>
                <button
                  onClick={() =>
                    download(
                      [
                        [
                          "id",
                          "tagId",
                          "label",
                          "inventoryLabel",
                          "serialNumber",
                          "categoryCode",
                          "batchDate",
                          "batch",
                          "visitorUrl",
                          "version",
                          "status",
                          "errorCode",
                        ],
                        ...jobs.map((j) => [
                          j.id,
                          j.tagId,
                          j.label,
                          j.inventoryLabel ?? "",
                          j.serialNumber ?? "",
                          j.categoryCode ?? "",
                          j.batchDate ?? "",
                          j.batch,
                          j.visitorUrl,
                          j.version,
                          j.status,
                          j.errorCode ?? "",
                        ]),
                      ],
                      "provisioning-jobs.csv",
                    )
                  }
                >
                  <Download size={16} />
                  {m.exportJobs}
                </button>
                <button onClick={() => setJobs(null)}>{m.close}</button>
                <ul>
                  {jobs.map((j) => (
                    <li key={j.id}>
                      {j.serialNumber ?? j.label}
                      {j.inventoryLabel && j.inventoryLabel !== j.label && ` · ${j.inventoryLabel}`}
                      {j.batchDate ? ` · ${j.batchDate}` : j.batch && ` · ${n.legacyBatch}: ${j.batch}`}
                      {` · ${m[j.status]}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {audit && (
              <section className="cloud-details">
                <h2>{m.audit}</h2>
                <button onClick={() => setAudit(null)}>{m.close}</button>
                <ul>
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      {entry.createdAt} · {entry.action} · {entry.operatorId} ·{" "}
                      {entry.tagId}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
      {session && transcription && <TranscriptionDialog
        key={transcription.recordingId}
        repository={repository}
        recordingId={transcription.recordingId}
        label={transcription.label}
        locale={locale}
        onAuthError={failure}
        onClose={() => setTranscription(null)}
      />}
      {session && correction && correction.recording?.pieceAssignment && <OperatorDialog
        titleId="piece-correction-title"
        locked={correctionSaving}
        onClose={() => { setCorrection(null); setCorrectionError(''); }}
      >
        <h2 id="piece-correction-title">{m.pieceDialog}</h2>
        <p>{m.pieceDialogHint}</p>
        {correctionError && <div className="admin-message error piece-correction-message" role="alert">
          <span>{correctionError}</span>
          {correctionStale && <button type="button" className="toolbar-secondary" onClick={() => {
            setCorrection(null);
            setCorrectionError('');
            setCorrectionStale(false);
            setActiveMapRecordingId(null);
            setPieceCode(undefined);
            setOffset(0);
            refresh();
          }}><RefreshCw size={15}/>{m.pieceReload}</button>}
        </div>}
        <label>
          {m.pieceSelect}
          <select aria-label={m.pieceSelect} value={correctionChoice} disabled={correctionSaving} onChange={(event) => setCorrectionChoice(event.target.value)}>
            <option value="needs_review">{m.pieceReview}</option>
            <option value="outside_map">{m.pieceOutside}</option>
            {MAP_PIECE_CODES.map((code) => <option key={code} value={`piece:${code}`}>{code}</option>)}
          </select>
        </label>
        <footer>
          <button type="button" disabled={correctionSaving} onClick={() => { setCorrection(null); setCorrectionError(''); }}>{m.pieceCancel}</button>
          <button type="button" className="toolbar-primary" disabled={correctionSaving} onClick={() => void savePieceCorrection()}>{correctionSaving ? n.working : m.pieceSave}</button>
        </footer>
      </OperatorDialog>}
      {bulk && group && (
        <OperatorDialog
          titleId="bulk-title"
          locked={busy}
          onClose={() => {
            setBulk(null);
            setError("");
            refresh();
          }}
        >
          <h2 id="bulk-title">
            {n[bulk.operation]} · {n[group.kind]} ({group.cards.length})
          </h2>
          {error && (
            <p role="alert" className="admin-message error">
              {error}
            </p>
          )}
          <p>
            {bulk.operation === "delete"
              ? n.deleteWarning
              : n.resetWarning}
          </p>
          <p>
            {group.recordingCount} {n.recordings}
          </p>
          <ul className="preview-labels">
            {group.cards.map((card) => (
              <li key={card.id}>{card.label}</li>
            ))}
          </ul>
          <label className="acknowledgment">
            <input
              autoFocus
              type="checkbox"
              checked={ack}
              disabled={busy || stale}
              onChange={(e) => setAck(e.target.checked)}
            />
            {n.ack}
          </label>
          {stale && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  preview(bulk.operation, bulk.ids),
                )
              }
            >
              {n.recheck}
            </button>
          )}
          <footer>
            <button
              disabled={busy}
              onClick={() => {
                setBulk(null);
                setError("");
                refresh();
              }}
            >
              <X size={16} />
              {n.cancel}
            </button>
            <button disabled={busy} onClick={advance}>
              {n.skip}
            </button>
            <button
              className={
                bulk.operation === "delete"
                  ? "danger-button"
                  : "toolbar-primary"
              }
              disabled={busy || !ack || stale}
              onClick={() => void run(apply)}
            >
              {busy
                ? n.working
                : bulk.operation === "delete"
                  ? n.confirmDelete
                  : n.confirmReset}
            </button>
          </footer>
        </OperatorDialog>
      )}
    </main>
  );
}
