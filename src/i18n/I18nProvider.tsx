import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { jaJP, zhCN, type MessageKey } from './messages';

export type Locale = 'zh-CN' | 'ja-JP';
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate };
const LANGUAGE_KEY = 'exhibition-audio-language-v2';
const I18nContext = createContext<I18nContextValue | null>(null);

function storedLocale(): Locale {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  return saved === 'zh-CN' || saved === 'ja-JP' ? saved : 'ja-JP';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(storedLocale);
  useEffect(() => { localStorage.setItem(LANGUAGE_KEY, locale); }, [locale]);
  const value = useMemo<I18nContextValue>(() => {
    const dictionary = locale === 'ja-JP' ? jaJP : zhCN;
    return {
      locale,
      setLocale,
      t: (key, values = {}) => Object.entries(values).reduce(
        (message, [name, replacement]) => message.replaceAll(`{{${name}}}`, String(replacement)),
        dictionary[key],
      ),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
