import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FileText,
  History,
  LogOut,
  MapPin,
  Play,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import type {
  StaffCard,
  StaffQuery,
  StaffRepository,
  StaffSession,
} from '../../storage/staffRepository';
import { useI18n } from '../../i18n/I18nProvider';
import type { MemoryCategoryCode } from '../../domain/classification';
import { StaffDetail } from './StaffDetail';
import { staffMessages, staffTime, type StaffMessages } from './staffMessages';
import './staff.css';

export type StaffTab = 'review' | 'location' | 'history';
const STAFF_LANGUAGE_KEY = 'exhibition-staff-language-v1';
type StaffLocale = 'zh-CN' | 'ja-JP' | 'en-US';
function initialStaffLocale(fallback: string): StaffLocale {
  try {
    const saved = localStorage.getItem(STAFF_LANGUAGE_KEY);
    if (saved === 'zh-CN' || saved === 'ja-JP' || saved === 'en-US')
      return saved;
  } catch {
    /* Use the application language when local storage is unavailable. */
  }
  if (fallback === 'zh-CN' || fallback === 'zh-TW') return 'zh-CN';
  if (fallback === 'en-US') return 'en-US';
  return 'ja-JP';
}
export function reviewStatus(card: StaffCard, m: StaffMessages) {
  const r = card.recording,
    q = r?.transcription;
  if (!r) return { key: 'empty', label: m.empty };
  if (!r.transcriptionConsent) return { key: 'none', label: m.notEnabled };
  if (!q || q.status === 'pending') return { key: 'pending', label: m.queued };
  if (q.status === 'processing')
    return { key: 'processing', label: m.processing };
  if (q.status === 'failed') return { key: 'failed', label: m.failed };
  return q.published
    ? { key: 'approved', label: m.approved }
    : { key: 'draft', label: m.unreviewed };
}

export function StaffPage({ repository }: { repository: StaffRepository }) {
  const { locale: appLocale } = useI18n();
  const [locale, setLocale] = useState<StaffLocale>(() =>
    initialStaffLocale(appLocale),
  );
  const m = staffMessages[locale];
  const [session, setSession] = useState<StaffSession | null>(null),
    [checking, setChecking] = useState(true);
  const [memberId, setMemberId] = useState(''),
    [choice, setChoice] = useState('');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<StaffCard[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(''),
    [querySearch, setQuerySearch] = useState(''),
    [date, setDate] = useState(''),
    [categoryCode, setCategoryCode] = useState<MemoryCategoryCode | ''>('');
  const [state, setState] = useState<StaffQuery['reviewState']>('all'),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<{
    card: StaffCard;
    tab: StaffTab;
    audio: boolean;
  } | null>(null);
  const alive = useRef(true),
    inFlight = useRef(false),
    requestSequence = useRef(0),
    authBusy = useRef(false);
  const member = session?.members.find((member) => member.id === memberId);
  const storageKey = (userId: string) =>
    `staff-member-v1:${repository.identityScope}:${userId}`;
  function remember(id: string, userId = session?.userId) {
    if (userId)
      try {
        if (id) localStorage.setItem(storageKey(userId), id);
        else localStorage.removeItem(storageKey(userId));
      } catch {
        /* Storage may be disabled in private browsers. */
      }
    setMemberId(id);
    setChoice(id);
  }
  function accept(value: StaffSession | null) {
    setSession(value);
    let saved = '';
    if (value)
      try {
        saved = localStorage.getItem(storageKey(value.userId)) ?? '';
      } catch {
        /* Keep this visit usable without persistence. */
      }
    const id = value?.members.some((member) => member.id === saved)
      ? saved
      : '';
    setMemberId(id);
    setChoice(id);
  }
  function failure(cause: unknown) {
    const code = cause instanceof Error ? cause.message : '';
    setError(
      code === 'LOGIN_FAILED'
        ? m.loginError
        : code === 'AUTH_REQUIRED'
          ? m.authError
          : code === 'STAFF_REQUIRED'
            ? m.roleError
            : m.error,
    );
    if (code === 'AUTH_REQUIRED' || code === 'STAFF_REQUIRED') {
      setSession(null);
      setMemberId('');
      setCards([]);
      setTotal(0);
      setNotice('');
      setDetail(null);
    }
    if (code === 'MEMBER_REQUIRED') {
      remember('');
      setDetail(null);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    repository
      .getSession()
      .then((value) => {
        if (active) accept(value);
      })
      .catch((cause) => {
        if (active) failure(cause);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [repository]);
  useEffect(() => {
    try {
      localStorage.setItem(STAFF_LANGUAGE_KEY, locale);
    } catch {
      /* Language remains usable for this visit without persistence. */
    }
  }, [locale]);
  useEffect(() => {
    if (!session) return;
    return repository.subscribeAuth?.((userId) => {
      if (userId !== session.userId && !authBusy.current)
        failure(Error('AUTH_REQUIRED'));
    });
  }, [repository, session?.userId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuerySearch(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!session || !member) return;
    let active = true;
    const sequence = ++requestSequence.current;
    inFlight.current = true;
    setLoading(true);
    setError('');
    repository
      .list({
        search: querySearch,
        reviewState: state,
        batchDate: date || undefined,
        categoryCode: categoryCode || undefined,
        offset,
        limit: 30,
      })
      .then((result) => {
        if (active) {
          setCards(result.cards);
          setTotal(result.total);
          if (offset > 0 && offset >= result.total) setOffset(0);
        }
      })
      .catch((cause) => {
        if (active) failure(cause);
      })
      .finally(() => {
        if (sequence === requestSequence.current) inFlight.current = false;
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    repository,
    session,
    memberId,
    querySearch,
    state,
    date,
    categoryCode,
    offset,
    revision,
  ]);
  useEffect(() => {
    if (!session || !member) return;
    const refresh = () => {
      if (!document.hidden && !inFlight.current) setRevision((v) => v + 1);
    };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [session, memberId]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (authBusy.current) return;
    authBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await repository.signIn(username, password);
      if (alive.current) {
        setPassword('');
        accept(value);
      }
    } catch (cause) {
      if (alive.current) failure(cause);
    } finally {
      authBusy.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function logout() {
    if (authBusy.current) return;
    authBusy.current = true;
    setBusy(true);
    try {
      await repository.signOut();
      if (alive.current) {
        remember('');
        setSession(null);
        setCards([]);
        setNotice('');
        setError('');
        setPassword('');
        setDetail(null);
      }
    } catch (cause) {
      if (alive.current) failure(cause);
    } finally {
      authBusy.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const open = (card: StaffCard, tab: StaffTab, audio = false) => {
    setError('');
    setNotice('');
    setDetail({ card, tab, audio });
  };
  return (
    <main className="staff-shell">
      <header className="staff-header">
        <div className="staff-account">
          <div
            className="staff-language-switch"
            role="group"
            aria-label={m.language}
          >
            {(
              [
                ['zh-CN', '中文'],
                ['ja-JP', '日本語'],
                ['en-US', 'English'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={locale === value}
                onClick={() => setLocale(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {member && (
            <button
              className="staff-person"
              disabled={!!detail || busy}
              title={m.switchMember}
              aria-label={m.switchMember}
              onClick={() => {
                remember('');
                setCards([]);
              }}
            >
              <UserRound size={17} />
              <span>{member.name}</span>
              <ChevronDown size={14} />
            </button>
          )}
          {session && (
            <button
              className="staff-icon"
              disabled={!!detail || busy}
              title={m.logout}
              aria-label={m.logout}
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      {checking ? (
        <p className="staff-wait" role="status">
          {m.loading}
        </p>
      ) : !session ? (
        <section className="staff-login">
          <h1>{m.loginTitle}</h1>
          <form onSubmit={(event) => void login(event)}>
            <label>
              {m.username}
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                required
                disabled={busy}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              {m.password}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                required
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && (
              <p className="staff-error" role="alert">
                {error}
              </p>
            )}
            <button className="staff-primary" disabled={busy}>
              {busy ? m.loading : m.login}
            </button>
          </form>
        </section>
      ) : !member ? (
        <section className="staff-login">
          <h1>{m.choose}</h1>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (session.members.some((value) => value.id === choice)) {
                remember(choice);
                setError('');
              }
            }}
          >
            <label>
              {m.member}
              <select
                required
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">{m.choose}</option>
                {session.members.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="staff-error" role="alert">
                {error}
              </p>
            )}
            <button className="staff-primary" disabled={!choice}>
              {m.enter}
            </button>
          </form>
        </section>
      ) : (
        <div className="staff-content">
          <div className="staff-title">
            <h1>{m.title}</h1>
            <span>
              {total} {m.total}
            </span>
            <button
              className="staff-icon"
              title={m.refresh}
              aria-label={m.refresh}
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={18} className={loading ? 'staff-spin' : ''} />
            </button>
          </div>
          <div className="staff-filters">
            <label className="staff-search">
              <Search size={18} />
              <input
                type="search"
                aria-label={m.search}
                placeholder={m.search}
                maxLength={120}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="staff-date">
              <span>{m.date}</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setOffset(0);
                }}
              />
              {date && (
                <button
                  className="staff-icon"
                  title={m.clearDate}
                  aria-label={m.clearDate}
                  onClick={() => {
                    setDate('');
                    setOffset(0);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="staff-category">
              <span>{m.categoryFilter}</span>
              <select
                aria-label={m.categoryFilter}
                value={categoryCode}
                onChange={(event) => {
                  setCategoryCode(
                    event.target.value as MemoryCategoryCode | '',
                  );
                  setOffset(0);
                }}
              >
                <option value="">{m.categoryAll}</option>
                <option value="A">{m.categoryA}</option>
                <option value="B">{m.categoryB}</option>
                <option value="C">{m.categoryC}</option>
                <option value="D">{m.categoryD}</option>
              </select>
            </label>
          </div>
          <div className="staff-tabs" role="tablist" aria-label={m.title}>
            {(['all', 'unreviewed', 'approved', 'empty'] as const).map(
              (value) => (
                <button
                  role="tab"
                  key={value}
                  aria-selected={state === value}
                  onClick={() => {
                    setState(value);
                    setOffset(0);
                  }}
                >
                  {m[value]}
                </button>
              ),
            )}
          </div>
          {error && (
            <p className="staff-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="staff-notice" role="status">
              {notice}
            </p>
          )}
          <section
            className="staff-list"
            aria-busy={loading}
            aria-label={m.all}
          >
            {!cards.length && (
              <p className="staff-empty" role="status">
                {loading ? m.loading : m.noResults}
              </p>
            )}
            {cards.map((card) => {
              const r = card.recording,
                status = reviewStatus(card, m);
              return (
                <article
                  className={`staff-record is-${status.key}`}
                  key={card.id}
                >
                  <div className="staff-record-meta">
                    <strong>{card.label}</strong>
                    <span
                      className={`staff-status is-${status.key}${
                        status.key === 'draft' || status.key === 'approved'
                          ? ' staff-sr-only'
                          : ''
                      }`}
                    >
                      {status.label}
                    </span>
                    {card.status === 'disabled' && (
                      <span className="staff-status is-failed">
                        {m.disabled}
                      </span>
                    )}
                    <div className="staff-record-time">
                      <span>{r ? m.recordedAt : m.createdAt}</span>
                      <time dateTime={r?.createdAt ?? card.createdAt}>
                        {staffTime(r?.createdAt ?? card.createdAt)}
                      </time>
                      <small>JST</small>
                    </div>
                  </div>
                  <p
                    className={`staff-transcript${r?.transcription?.text ? '' : ' is-missing'}`}
                  >
                    {r?.transcription?.text || (r ? m.noText : m.empty)}
                  </p>
                  <div className="staff-record-footer">
                    <div className="staff-reviewer">
                      {r?.latestReview && (
                        <>
                          <UserRound size={14} />
                          <span>{r.latestReview.memberName}</span>
                          <time dateTime={r.latestReview.createdAt}>
                            {staffTime(r.latestReview.createdAt)}
                          </time>
                        </>
                      )}
                    </div>
                    <div className="staff-record-actions">
                      {r && (
                        <>
                          <button
                            className="staff-icon"
                            disabled={card.status !== 'bound'}
                            title={m.listen}
                            aria-label={`${m.listen} ${card.label}`}
                            onClick={() => open(card, 'review', true)}
                          >
                            <Play size={17} />
                          </button>
                          <button
                            className="staff-action"
                            title={m.location}
                            aria-label={`${m.location} ${card.label}`}
                            onClick={() => open(card, 'location')}
                          >
                            <MapPin size={16} />
                            <span>
                              {r.pieceAssignment?.pieceCode ?? m.location}
                            </span>
                          </button>
                          <button
                            className="staff-action staff-review-button"
                            disabled={card.status !== 'bound'}
                            aria-label={`${m.review} ${card.label}`}
                            onClick={() => open(card, 'review')}
                          >
                            <FileText size={16} />
                            {m.review}
                          </button>
                        </>
                      )}
                      <button
                        className="staff-icon"
                        title={m.history}
                        aria-label={`${m.history} ${card.label}`}
                        onClick={() => open(card, 'history')}
                      >
                        <History size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          <nav className="staff-pagination" aria-label={m.page}>
            <button
              className="staff-icon"
              title={m.previous}
              aria-label={m.previous}
              disabled={offset === 0 || loading}
              onClick={() => setOffset((value) => Math.max(0, value - 30))}
            >
              <ArrowLeft size={19} />
            </button>
            <span>
              {Math.floor(offset / 30) + 1} /{' '}
              {Math.max(1, Math.ceil(total / 30))}
            </span>
            <button
              className="staff-icon"
              title={m.next}
              aria-label={m.next}
              disabled={offset + 30 >= total || loading}
              onClick={() => setOffset((value) => value + 30)}
            >
              <ArrowRight size={19} />
            </button>
          </nav>
        </div>
      )}
      {detail && member && (
        <StaffDetail
          key={detail.card.id}
          repository={repository}
          card={detail.card}
          member={member}
          initialTab={detail.tab}
          initialAudio={detail.audio}
          m={m}
          onAuthError={failure}
          onClose={() => setDetail(null)}
          onSaved={(published) => {
            setDetail(null);
            setNotice(published ? m.published : m.saved);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </main>
  );
}
