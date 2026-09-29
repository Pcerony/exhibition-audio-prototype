import { describe, expect, it } from 'vitest';
import { resolveAppRoute, resolveTagToken } from './App';

describe('visitor URL routing', () => {
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
    expect(resolveAppRoute('/admin', '')).toEqual({ type: 'admin' });
  });
});
