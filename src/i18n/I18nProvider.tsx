import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { jaJP, zhCN, type MessageKey } from './messages';
import { visitorLocales, visitorMessages, type VisitorLocale, type VisitorMessageKey } from './visitorMessages';

export type Locale = VisitorLocale;
type Translate = (key: MessageKey | VisitorMessageKey, values?: Record<string, string | number>) => string;
type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate };
const LANGUAGE_KEY = 'exhibition-audio-language-v2';
const I18nContext = createContext<I18nContextValue | null>(null);

function storedLocale(): Locale {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  return visitorLocales.includes(saved as Locale) ? saved as Locale : 'ja-JP';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(storedLocale);
  useEffect(() => { localStorage.setItem(LANGUAGE_KEY, locale); }, [locale]);
  const value = useMemo<I18nContextValue>(() => {
    const dictionary = { ...(locale === 'zh-CN' ? zhCN : jaJP), ...visitorMessages[locale] };
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

export function operatorLocale(locale: Locale): 'zh-CN' | 'ja-JP' {
  return locale === 'zh-CN' || locale === 'zh-TW' ? 'zh-CN' : 'ja-JP';
}

export function useOperatorI18n() {
  const context = useI18n();
  const locale = operatorLocale(context.locale);
  const dictionary = locale === 'zh-CN' ? zhCN : jaJP;
  const t: Translate = (key, values = {}) => {
    const message = key in dictionary ? dictionary[key as MessageKey] : context.t(key);
    return Object.entries(values).reduce((text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)), message);
  };
  return { ...context, locale, t };
}
