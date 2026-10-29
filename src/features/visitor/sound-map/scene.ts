import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SoundMapEntry } from '../../../storage/soundMapRepository';
import { modelPoint, type MapPoint } from './geography';
import { describeSoundMapEntry, type SoundMapCopy } from './soundMapMessages';
import type { VisitorLocale } from '../../../i18n/visitorMessages';
import { createMarkerGlyph } from './marker';
import { createCableLayer } from './cables';

type Polygon = number[][][];
type Geometry = { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
type Model = { roads: Geometry; water: Geometry; buildings: { geometry: Geometry; height: number }[] };
type Label = { id: string; text: string; category: string; xy: [number, number]; minScale: number; direction: [number, number] | null };
export type PositionedVoice = { entry: SoundMapEntry; point: MapPoint };
export type SoundMapScene = {
  setVoices(voices: PositionedVoice[]): void; select(id: string | null): void; focus(id: string): void;
  zoom(factor: number): void; rotate(): void; reset(): void; dispose(): void;
  connections(enabled: boolean): void;
};
export const topicColors: Record<string, string> = { A: '#c86678', B: '#437fa1', C: '#548262', D: '#9180aa' };

export async function mountSoundMap(options: {
  surface: HTMLDivElement; markers: HTMLDivElement; labels: HTMLDivElement; locale: VisitorLocale;
  reserved: () => DOMRect[]; copy: SoundMapCopy;
  onSelect: (entries: SoundMapEntry[]) => void; onUnavailable: () => void;
}): Promise<SoundMapScene> {
  const baseUrl = `${import.meta.env.BASE_URL}sound-map/`;
  async function asset<T>(name: string): Promise<T> {
    const response = await fetch(`${baseUrl}${name}`);
    if (!response.ok) throw Error('MAP_ASSET_UNAVAILABLE');
    return response.json();
  }
  const [data, west, labelData] = await Promise.all([
    asset<Model>('fukuoka-lite.json'), asset<Model>('fukuoka-west.json'), asset<Label[]>('fukuoka-labels.json'),
  ]);
  const markerLayer = document.createElement('div'); markerLayer.className = 'sm-scene-layer';
  const labelLayer = document.createElement('div'); labelLayer.className = 'sm-scene-layer';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9eeec');
  const camera = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 200);
  options.surface.append(renderer.domElement);
  options.markers.append(markerLayer); options.labels.append(labelLayer);
  const cables = createCableLayer(options.surface, topicColors);
  let connectionsEnabled = true;
  const lost = (event: Event) => { event.preventDefault(); options.onUnavailable(); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  scene.add(new THREE.HemisphereLight('#ffffff', '#889b90', 2.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2); sun.position.set(-12, 20, 8); scene.add(sun);
  function position(x: number, y: number, h = 0) { return new THREE.Vector3((x - 747) / 100, h, (658 - y) / 100); }
  function shapeFrom(rings: Polygon) {
    const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2((x - 747) / 100, (y - 658) / 100)));
    for (const ring of rings.slice(1)) shape.holes.push(new THREE.Path(ring.map(([x, y]) => new THREE.Vector2((x - 747) / 100, (y - 658) / 100))));
    return shape;
  }
  const polygons = (geometry: Geometry): Polygon[] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  function addSurface(geometry: Geometry, color: string, h: number) {
    const shapes = polygons(geometry).filter(r => r[0]?.length > 2).map(shapeFrom);
    if (!shapes.length) return;
    const g = new THREE.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); g.translate(0, h, 0);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(15.3, 0.32, 13.5), new THREE.MeshLambertMaterial({ color: '#c9d8ce' }));
  base.position.y = -0.2; scene.add(base);
  const westBase = new THREE.Mesh(new THREE.BoxGeometry(11.82, 0.32, 14.1), base.material);
  westBase.position.set(-13.56, -0.2, -0.17); scene.add(westBase);
  for (const model of [data, west]) {
    addSurface(model.roads, '#f5f6ef', 0.002); addSurface(model.water, '#8fbfc8', 0.012);
  }
  const geometries: THREE.BufferGeometry[] = [];
  for (const building of [...data.buildings, ...west.buildings]) {
    for (const rings of polygons(building.geometry)) {
      const g = new THREE.ExtrudeGeometry(shapeFrom(rings), { depth: building.height / 100 * 2.7, bevelEnabled: false, steps: 1, curveSegments: 1 });
      g.rotateX(-Math.PI / 2); g.translate(0, 0.025, 0); geometries.push(g);
    }
  }
  const merged = mergeGeometries(geometries, false);
  if (merged) scene.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: '#f3f5eb' })));
  geometries.forEach(g => g.dispose());
  // Reference from the independently extracted PLATEAU Ohori lake geometry, not Google Places.
  const ohori = modelPoint({ lat: 33.58569, lng: 130.37702 });
  const labels = [...labelData, { id: 'WEST01', text: '大濠公園', category: 'park', xy: [ohori.x, ohori.y] as [number, number], minScale: 17, direction: null }].map(item => {
    const el = document.createElement('span'); el.className = `sm-label ${item.category}${item.id === 'T01' || item.id === 'T04' ? ' primary' : ''}`;
    el.textContent = item.text; el.lang = 'ja';
    const leader = document.createElement('span'); leader.className = 'sm-label-leader'; leader.hidden = true;
    labelLayer.append(leader, el);
    return { ...item, el, leader, position: position(...item.xy, 0.35), width: 0, height: 0 };
  });
  let pins: { voice: PositionedVoice; el: HTMLButtonElement; group: SoundMapEntry[]; position: THREE.Vector3 }[] = [];
  const projectPoint = new THREE.Vector3();
  let disposed = false, frame = 0, selected: string | null = null, labelSizesDirty = true;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.screenSpacePanning = true;
  controls.minPolarAngle = Math.PI / 7; controls.maxPolarAngle = Math.PI / 2.7;
  controls.minZoom = 0.7; controls.maxZoom = 5;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.touches.ONE = THREE.TOUCH.PAN; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  function project(v: THREE.Vector3) {
    projectPoint.copy(v).project(camera);
    return { x: (projectPoint.x + 1) * options.surface.clientWidth / 2, y: (1 - projectPoint.y) * options.surface.clientHeight / 2, visible: projectPoint.z > -1 && projectPoint.z < 1 };
  }
  type Rect = { left: number; right: number; top: number; bottom: number };
  const intersects = (a: Rect, b: Rect, gap = 4) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  function draw() {
    frame = 0; if (disposed) return;
    renderer.render(scene, camera);
    if (labelSizesDirty) {
      // Batch DOM writes before measurements; panning must not force a layout per label.
      labels.forEach(item => { item.el.hidden = false; item.el.style.visibility = 'hidden'; });
      const sizes = labels.map(item => ({ width: item.el.offsetWidth, height: item.el.offsetHeight }));
      labels.forEach((item, i) => Object.assign(item, sizes[i]));
      labelSizesDirty = false;
    }
    const { clientWidth: width, clientHeight: height } = options.surface;
    const reserved = options.reserved();
    const groups: { x: number; y: number; items: typeof pins }[] = [];
    for (const pin of pins) {
      pin.el.hidden = true;
      const p = project(pin.position);
      if (!p.visible) continue;
      const group = groups.find(g => Math.hypot(g.x - p.x, g.y - p.y) < 14);
      if (group) group.items.push(pin); else groups.push({ x: p.x, y: p.y, items: [pin] });
    }
    const markerRects: Rect[] = [];
    const anchors = new Map<string, { x: number; y: number }>();
    for (const group of groups) {
      const pin = group.items.find(p => p.voice.entry.id === selected) ?? group.items[0];
      const rect = { left: group.x - 13, right: group.x + 13, top: group.y - 44, bottom: group.y - 11 };
      if (rect.right < 0 || rect.left > width || rect.bottom < 0 || rect.top > height || reserved.some(r => intersects(rect, r))) continue;
      pin.el.hidden = false; pin.el.style.left = `${group.x}px`; pin.el.style.top = `${group.y}px`;
      pin.group = group.items.map(p => p.voice.entry);
      for (const entry of pin.group) anchors.set(entry.id, { x: group.x, y: group.y - 20 });
      const count = pin.el.querySelector<HTMLElement>('.sm-pin-count')!;
      count.hidden = pin.group.length === 1; count.textContent = String(pin.group.length);
      const isSelected = pin.group.some(p => p.id === selected);
      pin.el.setAttribute('aria-pressed', String(isSelected));
      pin.el.setAttribute('aria-label', pin.group.length > 1 ? `${options.copy.group} ${pin.group.length}` : describeSoundMapEntry(pin.voice.entry, options.locale));
      markerRects.push(rect);
    }
    cables.layout(anchors, width, height);
    const occupied: Rect[] = [];
    const scale = height * camera.zoom / (camera.top - camera.bottom);
    for (const item of labels) {
      item.el.hidden = true; item.leader.hidden = true;
      const p = project(item.position);
      if (!p.visible || scale < item.minScale) continue;
      let angle = 0;
      if (item.direction) {
        const [dx, dy] = item.direction;
        const q = project(position(item.xy[0] + dx * 120, item.xy[1] + dy * 120, 0.35));
        angle = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
      }
      item.el.hidden = false; item.el.style.visibility = 'hidden';
      item.el.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
      const w = item.width, h = item.height, rad = angle * Math.PI / 180;
      const rw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const rh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      const offsets = item.category === 'road' ? [[0, 0], [0, -18], [0, 18], [-30, 0], [30, 0], [0, -35], [0, 35]]
        : [[0, -13], [0, 17], [0, -32], [0, 35], [-28, -10], [28, -10], [-40, -30], [40, -30], [0, -53], [0, 56], [-55, 20], [55, 20], [-50, -50], [50, -50]];
      let placed = false;
      for (const [dx, dy] of offsets) {
        const x = p.x + dx, y = p.y + dy;
        const rect = { left: x - rw / 2, right: x + rw / 2, top: y - rh / 2, bottom: y + rh / 2 };
        if (rect.left < 8 || rect.right > width - 8 || rect.top < 8 || rect.bottom > height - 8) continue;
        if (reserved.some(r => intersects(rect, r, 7)) || occupied.some(r => intersects(rect, r, 5)) || markerRects.some(r => intersects(rect, r, 2))) continue;
        item.el.style.left = `${x}px`; item.el.style.top = `${y}px`; item.el.style.visibility = 'visible';
        occupied.push(rect); placed = true;
        const length = Math.hypot(dx, dy);
        if (item.category !== 'road' && length > 22) {
          item.leader.hidden = false; item.leader.style.left = `${p.x}px`; item.leader.style.top = `${p.y}px`;
          item.leader.style.width = `${length}px`; item.leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        }
        break;
      }
      if (!placed) item.el.hidden = true;
    }
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
  function reset() {
    controls.target.set(-0.7, 0, 0); const mobile = options.surface.clientWidth < 600;
    camera.position.set(mobile ? 6 : 9.5, mobile ? 28 : 19, mobile ? 17 : 20);
    camera.zoom = mobile ? THREE.MathUtils.clamp(1.15 + (options.surface.clientHeight - 568) / 552, 1.15, 1.65) : 1.15;
    camera.updateProjectionMatrix(); controls.update(); schedule();
  }
  function resize() {
    const { clientWidth: w, clientHeight: h } = options.surface;
    if (!w || !h) return;
    const aspect = w / h, height = Math.max(16, 20 / aspect);
    camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
    labelSizesDirty = true; camera.updateProjectionMatrix(); renderer.setSize(w, h); schedule();
  }
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -19, 10);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -9, 9); schedule();
  });
  controls.addEventListener('end', () => cables.pulse());
  function updateConnections() {
    const category = pins.find(pin => pin.voice.entry.id === selected)?.voice.entry.categoryCode ?? null;
    cables.show(connectionsEnabled, category);
  }
  const observer = new ResizeObserver(resize); observer.observe(options.surface); resize(); reset();
  return {
    setVoices(voices) {
      pins = voices.map((voice, index) => {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'sm-pin';
        el.style.setProperty('--topic', topicColors[voice.entry.categoryCode ?? ''] ?? '#69796f');
        el.style.setProperty('--sway-delay', `${-(index % 11) * 0.31}s`);
        const flag = document.createElement('span'); flag.className = 'sm-flag';
        const glyph = createMarkerGlyph();
        const count = document.createElement('span'); count.className = 'sm-pin-count';
        flag.append(glyph, count); el.append(flag);
        const pin = { voice, el, group: [voice.entry], position: position(voice.point.x, voice.point.y, 1) };
        el.onclick = () => options.onSelect(pin.group);
        return pin;
      });
      markerLayer.replaceChildren(...pins.map(p => p.el));
      cables.setNodes(voices.map(voice => ({ id: voice.entry.id, topic: voice.entry.categoryCode, x: voice.point.x, y: voice.point.y })));
      updateConnections(); schedule();
    },
    select(id) { selected = id; updateConnections(); schedule(); },
    connections(enabled) { connectionsEnabled = enabled; updateConnections(); },
    focus(id) {
      const pin = pins.find(p => p.voice.entry.id === id); if (!pin) return;
      const delta = pin.position.clone().sub(controls.target); delta.y = 0;
      controls.target.add(delta); camera.position.add(delta); selected = id; updateConnections(); controls.update(); schedule();
    },
    zoom(factor) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.7, 5); camera.updateProjectionMatrix(); schedule(); },
    rotate() { camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 8).add(controls.target); controls.update(); schedule(); },
    reset,
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); } });
      cables.dispose(); renderer.dispose(); renderer.domElement.remove(); markerLayer.remove(); labelLayer.remove();
    },
  };
}
