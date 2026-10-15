import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LocationPicker } from './LocationPicker';
const mount = vi.hoisted(() => vi.fn());
vi.mock('./googleMaps', () => ({ mountLocationMap: mount }));
beforeEach(() => { localStorage.setItem('exhibition-audio-language-v2', 'zh-CN'); mount.mockReset(); });
it('does not select the default center and allows skipping', async () => {
  mount.mockResolvedValue(() => {});
  const done = vi.fn();
  render(<I18nProvider><LocationPicker onDone={done} /></I18nProvider>);
  expect(screen.getByRole('button', { name: '确认地点' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '跳过，直接录音' }));
  expect(done).toHaveBeenCalledWith(null);
});
it('confirms the explicitly selected point', async () => {
  mount.mockResolvedValue(() => {});
  const done = vi.fn();
  render(<I18nProvider><LocationPicker onDone={done} /></I18nProvider>);
  await waitFor(() => expect(mount).toHaveBeenCalled());
  const value = { source: 'pin', lat: 33.59, lng: 130.4 };
  const { act } = await import('@testing-library/react');
  act(() => mount.mock.calls[0][0].onSelect(value));
  fireEvent.click(screen.getByRole('button', { name: '确认地点' }));
  expect(done).toHaveBeenCalledWith(value);
});
it('keeps skip available when Google cannot load', async () => {
  mount.mockRejectedValue(new Error('offline'));
  render(<I18nProvider><LocationPicker onDone={vi.fn()} /></I18nProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('地图暂时无法加载');
  expect(screen.getByRole('button', { name: '跳过，直接录音' })).toBeEnabled();
});
