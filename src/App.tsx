import { useEffect, useState } from 'react';
import { ArrowUpRight, AudioLines, Nfc } from 'lucide-react';
import { AdminPage } from './features/admin/AdminPage';
import { VisitorPage } from './features/visitor/VisitorPage';
import { createBrowserRepository, type TagRepository } from './storage/repository';
import { LanguageSwitch } from './i18n/LanguageSwitch';
import { useI18n } from './i18n/I18nProvider';
import './styles.css';

const repository = createBrowserRepository();
const DEMO_TOKEN = 'demo-001';
let seedPromise: Promise<void> | null = null;

function seedDemoTag() {
  if (!seedPromise) {
    seedPromise = repository.listTags().then(async (tags) => {
      if (!tags.length && !(await repository.getTag(DEMO_TOKEN))) {
        await repository.createTag({ id: 'demo-tag', token: DEMO_TOKEN, label: 'Demo 01', batch: 'Demo' });
      }
    });
  }
  return seedPromise;
}

export function App() {
  const [route, setRoute] = useState(() => ({ pathname: window.location.pathname, hash: window.location.hash }));
  const [ready, setReady] = useState(false);
  const { locale, t } = useI18n();

  useEffect(() => {
    const updatePath = () => setRoute({ pathname: window.location.pathname, hash: window.location.hash });
    window.addEventListener('popstate', updatePath);
    window.addEventListener('hashchange', updatePath);
    seedDemoTag().then(() => {
      setReady(true);
    });
    return () => {
      window.removeEventListener('popstate', updatePath);
      window.removeEventListener('hashchange', updatePath);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }, [locale, t]);

  if (!ready) return <main className="boot-screen">{t('app.loading')}</main>;
  const resolvedRoute = resolveAppRoute(route.pathname, route.hash);
  if (resolvedRoute.type === 'tag') return <VisitorPage repository={repository} token={decodeURIComponent(resolvedRoute.token)} />;
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  if (resolvedRoute.type === 'admin') return <AdminPage repository={repository} baseUrl={baseUrl} />;
  return <main className="visitor-shell welcome-shell">
    <div className="visitor-topline"><span className="brand-mark"><AudioLines size={17} /></span><span>{t('app.title')}</span><span className="topline-rule" /><LanguageSwitch /></div>
    <section className="welcome-content">
      <p className="eyebrow">{t('welcome.kicker')}</p>
      <h1>{t('welcome.title')}</h1>
      <p className="visitor-intro">{t('welcome.body')}</p>
      <div className="nfc-instruction"><Nfc size={30} strokeWidth={1.6} /><p>{t('welcome.instruction')}</p></div>
      <a className="welcome-demo-link" href={`${baseUrl}#/t/${DEMO_TOKEN}`}>{t('welcome.demo')} <ArrowUpRight size={16} /></a>
    </section>
    <footer className="visitor-footer"><a href={`${baseUrl}#/admin`}>{t('welcome.admin')}</a></footer>
  </main>;
}

export function resolveTagToken(pathname: string, hash: string) {
  const activePath = hash.startsWith('#/') ? hash.slice(1) : pathname;
  return activePath.match(/^\/t\/([^/]+)\/?$/)?.[1] ?? null;
}

export function resolveAppRoute(pathname: string, hash: string): { type: 'tag'; token: string } | { type: 'admin' } | { type: 'welcome' } {
  const activePath = hash.startsWith('#/') ? hash.slice(1) : pathname;
  const token = activePath.match(/^\/t\/([^/]+)\/?$/)?.[1];
  if (token) return { type: 'tag', token };
  if (activePath === '/admin' || activePath === '/admin/') return { type: 'admin' };
  return { type: 'welcome' };
}

export function getRepositoryForTesting(): TagRepository {
  return repository;
}
