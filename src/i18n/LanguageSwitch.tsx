import { operatorLocale, useI18n } from './I18nProvider';
import './language-switch.css';
import { Languages } from 'lucide-react';
import { localeNames, visitorLocales, type VisitorLocale } from './visitorMessages';

export function LanguageSwitch({ visitor = false }: { visitor?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  if (visitor) return <label className="visitor-language-menu"><Languages size={20} aria-hidden="true" /><select aria-label="Language / 言語" value={locale} onChange={event => setLocale(event.target.value as VisitorLocale)}>{visitorLocales.map(value => <option key={value} value={value}>{localeNames[value]}</option>)}</select></label>;
  const activeLocale = operatorLocale(locale);
  return (
    <div className="language-switch" role="group" aria-label="Language / 言語">
      <button type="button" aria-pressed={activeLocale === 'zh-CN'} onClick={() => setLocale('zh-CN')}>{t('language.chinese')}</button>
      <button type="button" aria-pressed={activeLocale === 'ja-JP'} onClick={() => setLocale('ja-JP')}>{t('language.japanese')}</button>
    </div>
  );
}
