import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n, useOperatorI18n } from './I18nProvider';
import { LanguageSwitch } from './LanguageSwitch';
import { visitorLocales, visitorMessages } from './visitorMessages';

function TestCopy() {
  const { t } = useI18n();
  return <><p>{t('app.title')}</p><LanguageSwitch /></>;
}

function VisitorCopy() {
  const { t } = useI18n();
  return <><p>{t('visitor.start')}</p><LanguageSwitch visitor /></>;
}

function OperatorCopy() {
  const { t } = useOperatorI18n();
  return <p>{t('admin.title')}</p>;
}

describe('language preference', () => {
  beforeEach(() => localStorage.clear());

  it('retains visitor preference while management safely falls back to Japanese', () => {
    localStorage.setItem('exhibition-audio-language-v2', 'en');
    render(<I18nProvider><OperatorCopy /></I18nProvider>);
    expect(screen.getByText('展示タグ管理')).toBeInTheDocument();
    expect(localStorage.getItem('exhibition-audio-language-v2')).toBe('en');
  });

  it.each(visitorLocales)('has complete visitor copy and consistent placeholders for %s', locale => {
    for (const key of Object.keys(visitorMessages.en) as (keyof typeof visitorMessages.en)[]) {
      const text = visitorMessages[locale][key];
      expect(text, key).toBeTruthy();
      expect(text.match(/\{\{\w+\}\}/g) ?? [], key).toEqual(visitorMessages.en[key].match(/\{\{\w+\}\}/g) ?? []);
    }
  });

  it('uses WakuWaku Map as the exhibition title in each visitor language', () => {
    expect(visitorMessages['ja-JP']['app.title']).toBe('ワクワクマップ');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ko'] as const) {
      expect(visitorMessages[locale]['app.title']).toBe('WakuWaku Map');
    }
  });

  it.each([
    ['en', 'Start recording'], ['ko', '녹음 시작'], ['zh-TW', '開始錄音'],
  ])('selects and restores visitor language %s', (locale, text) => {
    const view = render(<I18nProvider><VisitorCopy /></I18nProvider>);
    expect(screen.getByRole('combobox', { name: 'Language / 言語' })).toHaveValue('ja-JP');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: locale } });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(localStorage.getItem('exhibition-audio-language-v2')).toBe(locale);
    view.unmount();
    render(<I18nProvider><VisitorCopy /></I18nProvider>);
    expect(screen.getByRole('combobox')).toHaveValue(locale);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('falls back to Japanese for an unknown stored language', () => {
    localStorage.setItem('exhibition-audio-language-v2', 'unknown');
    render(<I18nProvider><VisitorCopy /></I18nProvider>);
    expect(screen.getByText('録音を開始')).toBeInTheDocument();
  });

  it('starts in Japanese and persists Chinese when selected', () => {
    render(<I18nProvider><TestCopy /></I18nProvider>);
    expect(screen.getByText('ワクワクマップ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByText('WakuWaku Map')).toBeInTheDocument();
    expect(localStorage.getItem('exhibition-audio-language-v2')).toBe('zh-CN');
  });

  it('restores the saved Japanese preference', () => {
    localStorage.setItem('exhibition-audio-language-v2', 'ja-JP');
    render(<I18nProvider><TestCopy /></I18nProvider>);

    expect(screen.getByText('ワクワクマップ')).toBeInTheDocument();
  });

  it('defaults existing installations with an older Chinese preference to Japanese', () => {
    localStorage.setItem('exhibition-audio-language', 'zh-CN');
    render(<I18nProvider><TestCopy /></I18nProvider>);

    expect(screen.getByText('ワクワクマップ')).toBeInTheDocument();
  });
});
