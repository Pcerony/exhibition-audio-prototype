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

  it('starts in Chinese and persists Japanese when selected', () => {
    render(<I18nProvider><TestCopy /></I18nProvider>);
    expect(screen.getByText('声音档案')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '日本語' }));

    expect(screen.getByText('音声アーカイブ')).toBeInTheDocument();
    expect(localStorage.getItem('exhibition-audio-language')).toBe('ja-JP');
  });

  it('restores the saved Japanese preference', () => {
    localStorage.setItem('exhibition-audio-language', 'ja-JP');
    render(<I18nProvider><TestCopy /></I18nProvider>);

    expect(screen.getByText('音声アーカイブ')).toBeInTheDocument();
  });
});
