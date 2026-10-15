import { useEffect, useRef, useState } from "react";
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
  Pencil,
  Trash2,
  ArrowRightLeft,
  RotateCcw,
  X,
  Folder,
} from "lucide-react";
import type {
  AdminRepository,
  AuditEntry,
  ManagedTag,
  OperatorSession,
  ProvisioningJob,
  TagQuery,
  Category,
  BulkGroup,
  BulkOperation,
  BulkApply,
} from "../../storage/adminRepository";
import { useI18n } from "../../i18n/I18nProvider";
import { LanguageSwitch } from "../../i18n/LanguageSwitch";
import { cloudAdminMessages } from "./cloudAdminMessages";
import { operatorMessages } from "./operatorMessages";
import { OperatorDialog } from "./OperatorDialog";
import "./admin.css";
import "./cloud-admin.css";
type Props = { repository: AdminRepository; baseUrl: string };
type CreateRequest = { categoryId: string; count: number; key: string };
type BulkDialog = {
  operation: BulkOperation;
  targetCategoryId?: string;
  ids: string[];
  groups: BulkGroup[];
  index: number;
  requestKey: string;
};
const PAGE_SIZE = 50;
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [createCategoryId, setCreateCategoryId] = useState("");
  const [count, setCount] = useState(1);
  const [pending, setPending] = useState<CreateRequest | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<{
    id?: string;
    name: string;
    key: string;
  } | null>(null);
  const [tags, setTags] = useState<ManagedTag[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TagQuery["status"]>();
  const [sort, setSort] = useState<TagQuery["sort"]>("recorded_desc");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [jobs, setJobs] = useState<ProvisioningJob[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [bulk, setBulk] = useState<BulkDialog | null>(null);
  const [ack, setAck] = useState(false);
  const [stale, setStale] = useState(false);
  const visitorUrl = (tag: ManagedTag) =>
    tag.provisioning?.visitorUrl ??
    `${baseUrl.replace(/\/$/, "")}/#/t/${tag.token}`;
  function clear() {
    setSession(null);
    setCategories([]);
    setTags([]);
    setTotal(0);
    setSelected([]);
    setPending(null);
    setBulk(null);
    setCategoryEditor(null);
    setJobs(null);
    setAudit(null);
    setAudio(null);
  }
  function failure(cause: unknown) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "AUTH_REQUIRED" || code === "OPERATOR_REQUIRED") {
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
    } else if (code === "CATEGORY_NAME_EXISTS")
      setError(
        locale === "ja-JP"
          ? "同じ名前の分類が既にあります。"
          : "已存在同名分类。",
      );
    else setError(code === "LOGIN_FAILED" ? m.loginError : m.error);
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
    repository
      .listCategories()
      .then((value) => {
        if (active) setCategories(value);
      })
      .catch((cause) => {
        if (active) failure(cause);
      });
    return () => {
      active = false;
    };
  }, [repository, session, revision]);
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
        categoryId: categoryId || undefined,
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
  }, [repository, session, search, status, categoryId, sort, offset, revision]);
  const refresh = () => setRevision((v) => v + 1);
  async function create(request: CreateRequest) {
    setPending(request);
    await repository.createCards(
      request.categoryId,
      request.count,
      request.key,
    );
    setPending(null);
    setNotice(m.done);
    refresh();
  }
  async function preview(
    operation: BulkOperation,
    ids = selected,
    targetCategoryId = operation === "move" ? target : undefined,
  ) {
    const result = await repository.previewBulk(
      ids,
      operation,
      targetCategoryId,
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
      targetCategoryId,
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
      targetCategoryId: bulk.targetCategoryId,
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
        [m.label, n.categories, m.url, m.recording, m.write, n.recordedAt],
        ...all.map((tag) => [
          tag.label,
          tag.batch,
          visitorUrl(tag),
          tag.status ?? (tag.recording ? "bound" : "unbound"),
          tag.provisioning?.status ?? "pending",
          tag.recording?.createdAt ?? "",
        ]),
      ],
      "tags.csv",
    );
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
  const current = categories.find((category) => category.id === categoryId);
  const group = bulk?.groups[bulk.index];
  return (
    <main className="admin-shell cloud-admin">
      <header className="admin-header">
        <div className="admin-brand">
          <Shield size={20} />
          <strong>{m.title}</strong>
        </div>
        <div className="admin-header-right">
          <LanguageSwitch />
          {(session || roleError) &&
            icon(
              m.logout,
              <LogOut size={18} />,
              () =>
                void run(async () => {
                  await repository.signOut();
                  clear();
                  setRoleError(false);
                }),
            )}
        </div>
      </header>
      {error && !bulk && !categoryEditor && (
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
          <aside className="category-nav">
            <div className="category-heading">
              <h2>{n.categories}</h2>
              {icon(n.newCategory, <Plus size={17} />, () =>
                setCategoryEditor({ name: "", key: crypto.randomUUID() }),
              )}
            </div>
            <nav aria-label={n.categories}>
              <button
                className={!categoryId ? "active" : ""}
                disabled={busy || !!bulk}
                onClick={() => {
                  setCategoryId("");
                  setOffset(0);
                }}
              >
                <Folder size={16} />
                {m.all}
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={categoryId === category.id ? "active" : ""}
                  disabled={busy || !!bulk}
                  onClick={() => {
                    setCategoryId(category.id);
                    setCreateCategoryId(category.id);
                    setOffset(0);
                  }}
                >
                  <span className="category-code">{category.code}</span>
                  {category.name}
                </button>
              ))}
            </nav>
          </aside>
          <div className="admin-content">
            <div className="admin-title-row">
              <h1>{current ? `${current.code} · ${current.name}` : m.title}</h1>
              <span>{total}</span>
              <div className="row-actions">
                {current &&
                  icon(n.rename, <Pencil size={17} />, () =>
                    setCategoryEditor({
                      id: current.id,
                      name: current.name,
                      key: crypto.randomUUID(),
                    }),
                  )}
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
                  if (createCategoryId)
                    void run(() =>
                      create({
                        categoryId: createCategoryId,
                        count,
                        key: crypto.randomUUID(),
                      }),
                    );
                }}
              >
                <label>
                  {n.createCategory}
                  <select
                    value={createCategoryId}
                    required
                    disabled={busy || !!pending}
                    onChange={(e) => setCreateCategoryId(e.target.value)}
                  >
                    <option value="">{n.choose}</option>
                    {categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
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
                  disabled={busy || !!pending || !createCategoryId}
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
            <div className="table-controls">
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
              <select
                aria-label={n.destination}
                disabled={busy || !!bulk}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{n.destination}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!selected.length || !target || busy || !!bulk}
                onClick={() => void run(() => preview("move"))}
              >
                <ArrowRightLeft size={16} />
                {n.move}
              </button>
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
                    <th>{n.recordedAt}</th>
                    <th>{m.write}</th>
                    <th>{m.url}</th>
                    <th>{m.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => (
                    <tr key={tag.id}>
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
                        <strong>{tag.label}</strong>
                        <small>{tag.batch}</small>
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
                      </td>
                      <td className="time-cell">
                        {tag.recording
                          ? new Date(tag.recording.createdAt).toLocaleString(
                              locale,
                            )
                          : "—"}
                      </td>
                      <td>{m[tag.provisioning?.status ?? "pending"]}</td>
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
                    </tr>
                  ))}
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
                      {j.label} · {j.batch} · {m[j.status]}
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
      {categoryEditor && (
        <OperatorDialog
          titleId="category-title"
          locked={busy}
          onClose={() => setCategoryEditor(null)}
        >
          <h2 id="category-title">
            {categoryEditor.id ? n.rename : n.newCategory}
          </h2>
          {error && (
            <p role="alert" className="admin-message error">
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (categoryEditor.id)
                  await repository.renameCategory(
                    categoryEditor.id,
                    categoryEditor.name.trim(),
                  );
                else
                  await repository.createCategory(
                    categoryEditor.name.trim(),
                    categoryEditor.key,
                  );
                setCategoryEditor(null);
                refresh();
              });
            }}
          >
            <label>
              {n.categoryName}
              <input
                autoFocus
                required
                maxLength={80}
                value={categoryEditor.name}
                disabled={busy}
                onChange={(e) =>
                  setCategoryEditor({
                    ...categoryEditor,
                    name: e.target.value,
                  })
                }
              />
            </label>
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCategoryEditor(null)}
              >
                {n.cancel}
              </button>
              <button
                className="toolbar-primary"
                disabled={busy || !categoryEditor.name.trim()}
              >
                {n.save}
              </button>
            </footer>
          </form>
        </OperatorDialog>
      )}
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
              : bulk.operation === "reset"
                ? n.resetWarning
                : n.moveWarning}
          </p>
          <p>
            {group.recordingCount} {n.recordings}
            {bulk.operation === "move" &&
              ` → ${categories.find((c) => c.id === bulk.targetCategoryId)?.name ?? ""}`}
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
                  preview(bulk.operation, bulk.ids, bulk.targetCategoryId),
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
                  : bulk.operation === "move"
                    ? n.confirmMove
                    : n.confirmReset}
            </button>
          </footer>
        </OperatorDialog>
      )}
    </main>
  );
}
