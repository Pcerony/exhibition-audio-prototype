import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AdminPage } from './features/admin/AdminPage';
import { VisitorPage } from './features/visitor/VisitorPage';
import { createBrowserRepository, type TagRepository } from './storage/repository';
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
  const token = resolveTagToken(route.pathname, route.hash);
  if (token) return <VisitorPage repository={repository} token={decodeURIComponent(token)} />;
  const baseUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return <>
    <div className="prototype-route-link"><a href={`${baseUrl}#/t/${DEMO_TOKEN}`}>{t('app.openVisitor')} <ArrowUpRight size={14} /></a></div>
    <AdminPage repository={repository} baseUrl={baseUrl} />
  </>;
}

export function resolveTagToken(pathname: string, hash: string) {
  const activePath = hash.startsWith('#/') ? hash.slice(1) : pathname;
  return activePath.match(/^\/t\/([^/]+)\/?$/)?.[1] ?? null;
}

export function getRepositoryForTesting(): TagRepository {
  return repository;
}
