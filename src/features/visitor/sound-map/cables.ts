export type CableNode = { id: string; topic: string | null; x: number; y: number };
type CableEdge = { from: CableNode; to: CableNode };
type Anchor = { x: number; y: number };

export function cableEdges(nodes: CableNode[]): CableEdge[] {
  const edges: CableEdge[] = [];
  for (const topic of ['A', 'B', 'C', 'D']) {
    const unique: CableNode[] = [];
    for (const node of nodes.filter(value => value.topic === topic).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!unique.some(value => Math.hypot(value.x - node.x, value.y - node.y) < 1)) unique.push(node);
    }
    const connected = unique.splice(0, 1);
    // A minimum spanning tree gives every place a neighbour without an all-to-all web.
    while (unique.length) {
      let best: { from: CableNode; index: number; distance: number } | null = null;
      for (const from of connected) unique.forEach((to, index) => {
        const distance = Math.hypot(from.x - to.x, from.y - to.y);
        if (!best || distance < best.distance) best = { from, index, distance };
      });
      if (!best) break;
      const chosen = best as { from: CableNode; index: number; distance: number };
      const [to] = unique.splice(chosen.index, 1);
      edges.push({ from: chosen.from, to }); connected.push(to);
    }
  }
  return edges;
}

export function cableSag(distance: number, seconds: number) {
  const resting = Math.min(42, Math.max(10, distance * 0.14));
  return resting + (seconds < 2.4 ? Math.sin(seconds * 7) * Math.exp(-seconds * 2.6) * 5 : 0);
}

export function createCableLayer(parent: HTMLElement, colors: Record<string, string>) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('sm-cables'); svg.setAttribute('aria-hidden', 'true');
  parent.append(svg);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paths: { edge: CableEdge; path: SVGPathElement }[] = [];
  let anchors = new Map<string, Anchor>();
  let enabled = true, topic: string | null = null, frame = 0, start = 0, last = 0, disposed = false;
  function draw(seconds = 3) {
    for (const { edge, path } of paths) {
      const from = anchors.get(edge.from.id), to = anchors.get(edge.to.id);
      const visible = enabled && (!topic || edge.from.topic === topic) && from && to && Math.hypot(to.x - from.x, to.y - from.y) > 16;
      path.style.display = visible ? '' : 'none';
      if (!visible || !from || !to) continue;
      const sag = cableSag(Math.hypot(to.x - from.x, to.y - from.y), seconds);
      path.setAttribute('d', `M${from.x},${from.y} Q${(from.x + to.x) / 2},${(from.y + to.y) / 2 + sag * 2} ${to.x},${to.y}`);
      path.style.opacity = topic ? '0.8' : '0.55';
    }
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || !enabled || document.hidden || reduced.matches) { draw(); return; }
    const elapsed = (now - start) / 1000;
    if (now - last > 40 || elapsed >= 2.4) { last = now; draw(elapsed); }
    if (elapsed < 2.4) frame = requestAnimationFrame(tick);
  }
  function pulse() {
    cancelAnimationFrame(frame); frame = 0;
    if (disposed) return;
    start = performance.now(); last = 0; draw();
    if (enabled && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
  }
  function settle() { cancelAnimationFrame(frame); frame = 0; draw(); }
  reduced.addEventListener('change', settle);
  document.addEventListener('visibilitychange', settle);
  return {
    setNodes(nodes: CableNode[]) {
      paths = cableEdges(nodes).map(edge => {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('stroke', colors[edge.from.topic!] ?? '#69796f');
        path.dataset.topic = edge.from.topic!;
        return { edge, path };
      });
      svg.replaceChildren(...paths.map(value => value.path)); pulse();
    },
    layout(values: Map<string, Anchor>, width: number, height: number) {
      anchors = values; svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      draw(frame ? (performance.now() - start) / 1000 : 3);
    },
    show(value: boolean, category: string | null) { enabled = value; topic = category; pulse(); },
    pulse,
    dispose() {
      disposed = true; cancelAnimationFrame(frame); reduced.removeEventListener('change', settle);
      document.removeEventListener('visibilitychange', settle); svg.remove();
    },
  };
}
