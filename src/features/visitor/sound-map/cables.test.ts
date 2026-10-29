import { expect, it, vi } from 'vitest';
import { cableEdges, cableSag, createCableLayer } from './cables';

it('connects each theme with a sparse nearest-neighbour tree, never across themes', () => {
  const nodes = [
    { id: 'a', topic: 'A', x: 0, y: 0 }, { id: 'b', topic: 'A', x: 10, y: 0 },
    { id: 'c', topic: 'A', x: 20, y: 0 }, { id: 'd', topic: 'B', x: 0, y: 2 },
    { id: 'e', topic: 'B', x: 20, y: 2 },
  ];
  const edges = cableEdges(nodes);
  expect(edges).toHaveLength(3);
  expect(edges.every(edge => edge.from.topic === edge.to.topic)).toBe(true);
  expect(edges.filter(edge => edge.from.topic === 'A').every(edge => Math.abs(edge.from.x - edge.to.x) === 10)).toBe(true);
  expect(cableEdges(nodes.filter(node => node.topic === 'B'))).toHaveLength(1);
});
it('omits unknown topics and coincident locations without creating zero-length cables', () => {
  expect(cableEdges([{ id: 'a', topic: 'A', x: 0, y: 0 }, { id: 'b', topic: 'A', x: 0, y: 0 }, { id: 'c', topic: null, x: 2, y: 2 }])).toEqual([]);
});
it('sags under gravity, gently settles, and stays bounded', () => {
  expect(cableSag(200, 0)).toBeGreaterThan(0);
  expect(cableSag(200, 0.3)).not.toBe(cableSag(200, 0));
  expect(cableSag(200, 3)).toBeCloseTo(cableSag(200, 4), 1);
  expect(cableSag(2000, 0.3)).toBeLessThan(70);
});
it('filters to the selected theme, switches off, and cleans up its overlay and listeners', () => {
  const remove = vi.fn();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: remove }));
  try {
    const parent = document.createElement('div');
    const layer = createCableLayer(parent, { A: '#c86678', B: '#437fa1' });
    layer.setNodes([{ id: 'a', topic: 'A', x: 0, y: 0 }, { id: 'b', topic: 'A', x: 30, y: 0 }, { id: 'c', topic: 'B', x: 0, y: 40 }, { id: 'd', topic: 'B', x: 30, y: 40 }]);
    layer.layout(new Map([['a', { x: 0, y: 0 }], ['b', { x: 100, y: 0 }], ['c', { x: 0, y: 80 }], ['d', { x: 100, y: 80 }]]), 200, 200);
    const a = parent.querySelector<SVGPathElement>('[data-topic=A]')!;
    const b = parent.querySelector<SVGPathElement>('[data-topic=B]')!;
    expect(a.getAttribute('d')).toContain(' Q');
    expect(a.getAttribute('stroke')).toBe('#c86678');
    layer.show(true, 'A');
    expect(a.style.display).toBe(''); expect(b.style.display).toBe('none');
    layer.show(false, 'A'); expect(a.style.display).toBe('none');
    layer.dispose(); expect(parent.childElementCount).toBe(0); expect(remove).toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
