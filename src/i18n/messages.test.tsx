import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from './I18nProvider';
import { LanguageSwitch } from './LanguageSwitch';

function TestCopy() {
  const { t } = useI18n();
  return <><p>{t('app.title')}</p><LanguageSwitch /></>;
}

describe('language preference', () => {
  beforeEach(() => localStorage.clear());

  it('starts in Japanese and persists Chinese when selected', () => {
    render(<I18nProvider><TestCopy /></I18nProvider>);
    expect(screen.getByText('音声アーカイブ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByText('声音档案')).toBeInTheDocument();
    expect(localStorage.getItem('exhibition-audio-language-v2')).toBe('zh-CN');
  });

  it('restores the saved Japanese preference', () => {
    localStorage.setItem('exhibition-audio-language-v2', 'ja-JP');
    render(<I18nProvider><TestCopy /></I18nProvider>);

    expect(screen.getByText('音声アーカイブ')).toBeInTheDocument();
  });

  it('defaults existing installations with an older Chinese preference to Japanese', () => {
    localStorage.setItem('exhibition-audio-language', 'zh-CN');
    render(<I18nProvider><TestCopy /></I18nProvider>);

    expect(screen.getByText('音声アーカイブ')).toBeInTheDocument();
  });
});
