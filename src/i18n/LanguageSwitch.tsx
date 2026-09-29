import { useI18n } from './I18nProvider';
import './language-switch.css';

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="language-switch" role="group" aria-label="Language / 言語">
      <button type="button" aria-pressed={locale === 'zh-CN'} onClick={() => setLocale('zh-CN')}>{t('language.chinese')}</button>
      <button type="button" aria-pressed={locale === 'ja-JP'} onClick={() => setLocale('ja-JP')}>{t('language.japanese')}</button>
    </div>
  );
}
