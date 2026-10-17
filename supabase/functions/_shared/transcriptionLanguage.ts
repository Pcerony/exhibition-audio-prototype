export const transcriptionLanguages = new Set([
  'ja', 'zh', 'en', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'vi', 'th', 'id', 'ar', 'hi', 'auto',
]);

export function isTranscriptionLanguage(value: unknown): value is string {
  return typeof value === 'string' && transcriptionLanguages.has(value);
}
