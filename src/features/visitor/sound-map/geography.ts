import proj4 from 'proj4';

export type Coordinates = { lat: number; lng: number };
export type MapPoint = { x: number; y: number };
const projection = '+proj=tmerc +lat_0=33 +lon_0=131 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const origin = [-56136.38478794821, 63947.58389222502];
const scale = 1000 / 1954.945890111316;

export function modelPoint({ lat, lng }: Coordinates): MapPoint {
  const [x, y] = proj4('EPSG:4326', projection, [lng, lat]);
  return { x: (x - origin[0]) * scale + 30, y: (y - origin[1]) * scale + 30 };
}

export function inSoundMap(point: MapPoint) {
  return point.x >= -1200 && point.x <= 1530 && point.y >= -30 && point.y <= 1380;
}
