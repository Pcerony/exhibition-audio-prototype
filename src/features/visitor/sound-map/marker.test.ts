import { expect, it } from 'vitest';
import { createMarkerGlyph } from './marker';

it('clips the original lab logo to the umbrella, excluding its wordmark', () => {
  const glyph = createMarkerGlyph();
  expect(glyph.tagName.toLowerCase()).toBe('svg');
  expect(glyph.getAttribute('viewBox')).toBe('0 0 202 269');
  expect(glyph.getAttribute('overflow')).toBe('hidden');
  expect(glyph.querySelector('image')?.getAttribute('width')).toBe('947');
  expect(glyph.textContent).toBe('');
});
