import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PolicyPage } from './PolicyPage';
import { I18nProvider } from '../../i18n/I18nProvider';

it('explains optional public locations and links Google privacy policy', () => {
  localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
  render(<I18nProvider><PolicyPage kind="privacy" /></I18nProvider>);
  expect(screen.getByRole('link', { name: 'Google 隐私政策' })).toHaveAttribute('href', 'https://policies.google.com/privacy');
  expect(screen.getByText(/不会自动获取手机定位/)).toBeInTheDocument();
});
