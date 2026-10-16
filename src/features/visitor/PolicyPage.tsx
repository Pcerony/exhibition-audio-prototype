import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';

export function PolicyLinks() {
  const { t } = useI18n();
  return <nav className="policy-links" aria-label={t('policy.nav')}>
    <a href="#/privacy" target="_blank" rel="noreferrer">{t('policy.privacy')}</a>
    <a href="#/terms" target="_blank" rel="noreferrer">{t('policy.terms')}</a>
  </nav>;
}

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t } = useI18n();
  const privacy = kind === 'privacy';
  return <main className="visitor-shell">
    <div className="visitor-topline"><a href="#/">{t('app.title')}</a><span className="topline-rule" /><LanguageSwitch visitor /></div>
    <h1>{t(privacy ? 'policy.privacy' : 'policy.terms')}</h1>
    {privacy ? <>
      <p>{t('policy.data')}</p><p>{t('policy.optional')}</p><p>{t('policy.services')}</p>
      <p><a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{t('policy.googlePrivacy')}</a></p>
      <p>{t('policy.retention')}</p>
    </> : <>
      <p>{t('policy.rights')}</p><p>{t('policy.binding')}</p><p>{t('policy.mapsTerms')}</p>
      <p><a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">{t('policy.googleTerms')}</a></p>
    </>}
    <PolicyLinks />
  </main>;
}
