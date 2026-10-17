import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, LogOut, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { QrEntry } from '../../storage/adminRepository';
import { useOperatorI18n } from '../../i18n/I18nProvider';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { qrFallbackMessages } from './qrFallbackMessages';
import './admin.css';
import './cloud-admin.css';
import './qr-fallback.css';

type QrSession = { userId: string };
type QrRepository = {
  getSession(): Promise<QrSession | null>;
  signIn(identifier: string, password: string): Promise<QrSession>;
  signOut(): Promise<void>;
  createQrEntry(requestKey: string): Promise<QrEntry>;
};
type Props = { repository: QrRepository; loginMode?: 'operator' | 'staff'; backHref?: string };
const CURRENT_KEY = 'exhibition-qr-current-request-v1';
const PENDING_KEY = 'exhibition-qr-pending-request-v1';
const HISTORY_KEY = 'exhibition-qr-history-v1';

function storedQrHistory(userId: string): QrEntry[] {
  try {
    const raw = sessionStorage.getItem(`${HISTORY_KEY}:${userId}`);
    const values: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is QrEntry => {
      if (!value || typeof value !== 'object') return false;
      const entry = value as Partial<QrEntry>;
      if (typeof entry.id !== 'string' || !entry.id || typeof entry.label !== 'string' || !entry.label
        || entry.entryChannel !== 'qr' || typeof entry.visitorUrl !== 'string') return false;
      try {
        const url = new URL(entry.visitorUrl);
        return url.protocol === 'https:'
          && (url.hostname === 'voice.heisei.space' || url.origin === window.location.origin)
          && /^#\/t\/[^/?#]+$/.test(url.hash);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function QrFallbackPage({ repository, loginMode = 'operator', backHref = '#/admin' }: Props) {
  const { locale } = useOperatorI18n();
  const m = qrFallbackMessages[locale];
  const [session, setSession] = useState<QrSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const restoredRef = useRef(false);
  const [identifier, setIdentifier] = useState(loginMode === 'staff' ? 'staff' : '');
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState<QrEntry | null>(null);
  const [history, setHistory] = useState<QrEntry[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const historyRef = useRef<QrEntry[]>([]);

  function storageKey(userId: string, key: string) {
    return `${key}:${userId}`;
  }

  function clearIssuance(userId?: string) {
    setCurrent(null);
    historyRef.current = [];
    setHistory([]);
    setPendingKey(null);
    if (userId) {
      try {
        sessionStorage.removeItem(storageKey(userId, CURRENT_KEY));
        sessionStorage.removeItem(storageKey(userId, PENDING_KEY));
        sessionStorage.removeItem(storageKey(userId, HISTORY_KEY));
      } catch {
        // Keep logout independent from browser storage availability.
      }
    }
  }

  async function issue(key: string, userId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const pendingStorageKey = storageKey(userId, PENDING_KEY);
    try {
      const entry = await repository.createQrEntry(key);
      try {
        sessionStorage.setItem(storageKey(userId, CURRENT_KEY), key);
        sessionStorage.removeItem(pendingStorageKey);
      } catch {
        // Keep a successful server response visible even if storage becomes unavailable.
      }
      const prior = historyRef.current;
      const nextHistory = prior.some((item) => item.id === entry.id)
        ? prior.map((item) => item.id === entry.id ? entry : item)
        : [...prior, entry];
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      try {
        sessionStorage.setItem(storageKey(userId, HISTORY_KEY), JSON.stringify(nextHistory));
      } catch {
        // Keep the in-memory list usable when browser storage is unavailable.
      }
      setCurrent(entry);
      setPendingKey(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (code === 'AUTH_REQUIRED' || code === 'OPERATOR_REQUIRED' || code === 'STAFF_REQUIRED') {
        clearIssuance(userId);
        setSession(null);
        setError(code === 'AUTH_REQUIRED' ? m.authError : loginMode === 'staff' ? m.staffAccountError : m.operatorError);
      } else {
        try {
          sessionStorage.setItem(pendingStorageKey, key);
        } catch {
          // Keep the retry key in memory when persistence becomes unavailable.
        }
        setPendingKey(key);
        setError(m.error);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    repository.getSession().then((value) => {
      if (active) setSession(value);
    }).catch(() => {
      if (active) setError(m.authError);
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [repository, m.authError]);

  useEffect(() => {
    if (!session || restoredRef.current) return;
    restoredRef.current = true;
    const restoredHistory = storedQrHistory(session.userId);
    historyRef.current = restoredHistory;
    setHistory(restoredHistory);
    setCurrent(restoredHistory.at(-1) ?? null);
    let pending: string | null;
    let current: string | null;
    try {
      pending = sessionStorage.getItem(storageKey(session.userId, PENDING_KEY));
      current = sessionStorage.getItem(storageKey(session.userId, CURRENT_KEY));
    } catch {
      setError(m.error);
      return;
    }
    const key = pending ?? current;
    if (key) {
      if (pending) setPendingKey(key);
      void issue(key, session.userId);
    }
  }, [session]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = await repository.signIn(loginMode === 'staff' ? 'staff' : identifier.trim(), password);
      setPassword('');
      setSession(value);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      setError(code === 'OPERATOR_REQUIRED' ? m.operatorError : code === 'STAFF_REQUIRED' ? m.staffAccountError : m.loginError);
    } finally {
      setBusy(false);
    }
  }

  function createNext() {
    if (!session || busyRef.current) return;
    const key = crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey(session.userId, PENDING_KEY), key);
    } catch {
      setError(m.error);
      return;
    }
    setPendingKey(key);
    void issue(key, session.userId);
  }

  return (
    <main className="admin-shell cloud-admin qr-fallback-shell">
      <header className="qr-fallback-header">
        <div className="qr-fallback-brand"><QrCode size={20} /><strong>{m.title}</strong></div>
        <div className="qr-fallback-header-actions">
          <a className="qr-fallback-back" href={backHref} aria-label={loginMode === 'staff' ? m.staffBack : m.back} title={loginMode === 'staff' ? m.staffBack : m.back}>
            <ArrowLeft size={18} /><span>{loginMode === 'staff' ? m.staffBack : m.back}</span>
          </a>
          <LanguageSwitch />
          {session && <button type="button" className="icon-button" aria-label={m.logout} title={m.logout} disabled={busy} onClick={() => {
            void repository.signOut().catch(() => {}).finally(() => {
              clearIssuance(session.userId);
              setSession(null);
              setError('');
            });
          }}><LogOut size={18} /></button>}
        </div>
      </header>
      <section className="qr-fallback-stage">
        {error && <p className="admin-message error qr-fallback-message" role="alert">{error}</p>}
        {checking ? <p className="qr-fallback-loading" role="status">{m.loading}</p> : !session ? (
          <section className="cloud-login">
            <h1>{m.login}</h1>
            <form onSubmit={(event) => void login(event)}>
              <label>{loginMode === 'staff' ? m.username : m.email}<input type={loginMode === 'staff' ? 'text' : 'email'} required autoComplete="username" value={identifier} readOnly={loginMode === 'staff'} onChange={(event) => setIdentifier(event.target.value)} /></label>
              <label>{m.password}<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button className="toolbar-primary" disabled={busy}>{m.login}</button>
            </form>
          </section>
        ) : (
          <>
            <div className={`qr-fallback-workspace${history.length ? ' has-history' : ''}`}>
              {history.length > 0 && <section className="qr-fallback-history" aria-labelledby="qr-fallback-history-title">
                <h2 id="qr-fallback-history-title">{m.history}</h2>
                <ul>
                  {[...history].reverse().map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="qr-fallback-history-item"
                        aria-label={m.selectQr.replace('{{label}}', entry.label)}
                        aria-pressed={current?.id === entry.id}
                        onClick={() => setCurrent(entry)}
                      >
                        <QrCode size={18} aria-hidden="true" />
                        <span>{entry.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>}
              <section className="qr-fallback-current" aria-live="polite">
                <h1>{current?.label ?? m.title}</h1>
                {current && <div className="qr-fallback-output">
                  <div className="qr-fallback-code" role="img" aria-label={m.qrLabel.replace('{{label}}', current.label)}>
                    <QRCodeSVG value={current.visitorUrl} size={288} level="M" marginSize={2} aria-hidden="true" />
                  </div>
                  <p className="qr-fallback-label">{current.label}</p>
                </div>}
                {busy && <p className="qr-fallback-loading" role="status">{m.creating}</p>}
                {error && pendingKey && <div className="qr-fallback-actions">
                  <button className="toolbar-primary" disabled={busy} onClick={() => void issue(pendingKey, session.userId)}>{m.retry}</button>
                </div>}
                {!error && !busy && <div className="qr-fallback-actions">
                  <button className="toolbar-primary" onClick={createNext}>{current ? m.next : m.create}</button>
                </div>}
              </section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
