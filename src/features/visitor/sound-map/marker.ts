export function createMarkerGlyph(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const glyph = document.createElementNS(ns, 'svg');
  glyph.setAttribute('viewBox', '0 0 202 269');
  glyph.setAttribute('width', '18');
  glyph.setAttribute('height', '24');
  glyph.setAttribute('overflow', 'hidden');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.setAttribute('focusable', 'false');
  glyph.classList.add('sm-glyph');
  // Crop the original raster logo in the SVG viewport, including on mobile Safari.
  const image = document.createElementNS(ns, 'image');
  image.setAttribute('href', `${import.meta.env.BASE_URL}sodeslab-logo.png`);
  image.setAttribute('width', '947');
  image.setAttribute('height', '269');
  glyph.append(image);
  return glyph;
}
