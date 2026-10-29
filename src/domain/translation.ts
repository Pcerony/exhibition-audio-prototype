export const translationLanguages = [
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
] as const;

export type TranslationLanguage = typeof translationLanguages[number]['code'];

export function defaultTranslationLanguage(locale: string): TranslationLanguage {
  switch (locale) {
    case 'ja-JP': return 'ja';
    case 'zh-CN': return 'zh-CN';
    case 'zh-TW': return 'zh-TW';
    case 'ko': return 'ko';
    case 'en': return 'en';
    default: return 'en';
  }
}
