import { expect, it } from 'vitest';
import { defaultTranslationLanguage, translationLanguages } from './translation';

it('offers the supported visitor translation targets and defaults to the current interface language', () => {
  expect(translationLanguages.map(language => language.code)).toEqual([
    'ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'th', 'vi', 'id',
  ]);
  expect(defaultTranslationLanguage('ja-JP')).toBe('ja');
  expect(defaultTranslationLanguage('zh-CN')).toBe('zh-CN');
  expect(defaultTranslationLanguage('zh-TW')).toBe('zh-TW');
  expect(defaultTranslationLanguage('ko')).toBe('ko');
  expect(defaultTranslationLanguage('en')).toBe('en');
});
