export const transcriptionLanguages = [
  {code:'ja',label:'日本語'}, {code:'zh',label:'中文'},
  {code:'en',label:'English'}, {code:'ko',label:'한국어'},
  {code:'es',label:'Español'}, {code:'fr',label:'Français'},
  {code:'de',label:'Deutsch'}, {code:'it',label:'Italiano'},
  {code:'pt',label:'Português'}, {code:'ru',label:'Русский'},
  {code:'vi',label:'Tiếng Việt'}, {code:'th',label:'ไทย'},
  {code:'id',label:'Bahasa Indonesia'}, {code:'ar',label:'العربية'},
  {code:'hi',label:'हिन्दी'}, {code:'auto',label:''},
] as const;
export type TranscriptionLanguage = typeof transcriptionLanguages[number]['code'];
export function transcriptionLanguageForLocale(locale: string): TranscriptionLanguage {
  if (locale === 'zh-CN' || locale === 'zh-TW') return 'zh';
  if (locale === 'en-US') return 'en';
  if (locale === 'ko-KR') return 'ko';
  return 'ja';
}
