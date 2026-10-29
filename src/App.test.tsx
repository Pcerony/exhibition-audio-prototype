import { describe, expect, it } from 'vitest';
import { resolveAppRoute, resolveTagToken } from './App';

describe('visitor URL routing', () => {
  it('opens the independent sound map without changing existing chip routes', () => {
    expect(resolveAppRoute('/', '#/map')).toEqual({ type: 'map' });
    expect(resolveAppRoute('/map', '')).toEqual({ type: 'map' });
    expect(resolveTagToken('/', '#/map')).toBeNull();
    expect(resolveAppRoute('/', '#/t/opaque-token')).toEqual({ type: 'tag', token: 'opaque-token' });
  });
  it('keeps the restricted staff website separate from the full admin', () => {
    expect(resolveAppRoute('/', '#/staff')).toEqual({ type: 'staff' });
    expect(resolveAppRoute('/staff', '')).toEqual({ type: 'staff' });
    expect(resolveAppRoute('/', '#/staff/qr')).toEqual({ type: 'staffQr' });
  });
  it('opens a dedicated preview without treating it as a real tag', () => {
    expect(resolveAppRoute('/', '#/preview')).toEqual({ type: 'preview' });
    expect(resolveTagToken('/', '#/preview')).toBeNull();
  });
  it('opens public privacy and terms routes', () => {
    expect(resolveAppRoute('/', '#/privacy')).toEqual({ type: 'privacy' });
    expect(resolveAppRoute('/', '#/terms')).toEqual({ type: 'terms' });
  });
  it('resolves regular paths used in local development', () => {
    expect(resolveTagToken('/t/tag-a', '')).toBe('tag-a');
  });

  it('resolves hash routes used by GitHub Pages', () => {
    expect(resolveTagToken('/exhibition-audio-prototype/', '#/t/tag-a')).toBe('tag-a');
  });

  it('does not treat the operator root as a visitor tag', () => {
    expect(resolveTagToken('/exhibition-audio-prototype/', '')).toBeNull();
  });

  it('starts at the NFC touch welcome page and keeps the operator page explicit', () => {
    expect(resolveAppRoute('/exhibition-audio-prototype/', '')).toEqual({ type: 'welcome' });
    expect(resolveAppRoute('/exhibition-audio-prototype/', '#/admin')).toEqual({ type: 'admin' });
    expect(resolveAppRoute('/exhibition-audio-prototype/', '#/admin/qr')).toEqual({ type: 'qr' });
    expect(resolveAppRoute('/admin', '')).toEqual({ type: 'admin' });
    expect(resolveAppRoute('/admin/qr', '')).toEqual({ type: 'qr' });
  });
});
