import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LocationPicker } from './LocationPicker';
import { mapLanguages, visitorLocales } from '../../i18n/visitorMessages';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
const mount = vi.hoisted(() => vi.fn());
vi.mock('./googleMaps', () => ({ mountLocationMap: mount }));
beforeEach(() => { localStorage.setItem('exhibition-audio-language-v2', 'zh-CN'); mount.mockReset(); });
it.each(visitorLocales)('initializes map in %s', async locale => {
  localStorage.setItem('exhibition-audio-language-v2', locale);
  mount.mockResolvedValue(() => {});
  render(<I18nProvider><LocationPicker onDone={vi.fn()} /></I18nProvider>);
  await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  expect(mount.mock.calls[0][0].language).toBe(mapLanguages[locale]);
});
it('does not select the default center and allows skipping', async () => {
  mount.mockResolvedValue(() => {});
  const done = vi.fn();
  render(<I18nProvider><LanguageSwitch visitor /><LocationPicker onDone={done} /></I18nProvider>);
  expect(screen.getByRole('button', { name: '确认地点' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '跳过，直接录音' }));
  expect(done).toHaveBeenCalledWith(null);
});
it('confirms the explicitly selected point', async () => {
  mount.mockResolvedValue(() => {});
  const done = vi.fn();
  render(<I18nProvider><LanguageSwitch visitor /><LocationPicker onDone={done} /></I18nProvider>);
  await waitFor(() => expect(mount).toHaveBeenCalled());
  const value = { source: 'pin', lat: 33.59, lng: 130.4 };
  const { act } = await import('@testing-library/react');
  const mapPoint = { lat: value.lat, lng: value.lng };
  act(() => mount.mock.calls[0][0].onSelect({ location: value, mapPoint }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
  expect(mount).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));
  expect(done).toHaveBeenCalledWith(value, mapPoint);
});
it('keeps skip available when Google cannot load', async () => {
  mount.mockRejectedValue(new Error('offline'));
  render(<I18nProvider><LocationPicker onDone={vi.fn()} /></I18nProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('地图暂时无法加载');
  expect(screen.getByRole('button', { name: '跳过，直接录音' })).toBeEnabled();
});
