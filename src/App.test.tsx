import { describe, expect, it } from 'vitest';
import { resolveTagToken } from './App';

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
});
