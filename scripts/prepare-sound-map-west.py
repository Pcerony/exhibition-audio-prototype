"""Generate only static western map geometry; never reads visitor/cloud data."""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--model-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
import numpy as np
from pyproj import Transformer
from shapely import affinity, make_valid
from shapely.geometry import Polygon, box, mapping
from shapely.ops import unary_union

ns = {'g': 'http://www.opengis.net/gml', 'b': 'http://www.opengis.net/citygml/building/2.0',
      'l': 'http://www.opengis.net/citygml/landuse/2.0'}
project = Transformer.from_crs(6668, 6670, always_xy=True)

def polygons(geometry):
    if isinstance(geometry, Polygon):
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from polygons(part)

def positions(element):
    values = np.fromstring(element.text, sep=' ').reshape(-1, 3)
    x, y = project.transform(values[:, 1], values[:, 0])
    return np.column_stack((x, y, values[:, 2]))

def read_polygons(element):
    result = []
    for poly in element.findall('.//g:Polygon', ns):
        shell = poly.find('g:exterior/g:LinearRing/g:posList', ns)
        if shell is None:
            continue
        holes = [positions(r)[:, :2] for r in poly.findall('g:interior/g:LinearRing/g:posList', ns)]
        result.extend(polygons(make_valid(Polygon(positions(shell)[:, :2], holes))))
    return result

def read_water(extent):
    result = []
    for file in sorted((args.model_root / 'source').glob('*_luse_*.gml')):
        for _, element in ET.iterparse(file, events=('end',)):
            if element.tag != '{' + ns['l'] + '}LandUse':
                continue
            if element.findtext('l:class', namespaces=ns) == '204':
                result.extend(p.intersection(extent) for p in read_polygons(element) if p.intersects(extent))
            element.clear()
        print('Western water:', file.name, flush=True)
    return unary_union(result)

def read_buildings(extent):
    result, seen = [], set()
    for file in sorted((args.model_root / 'source').glob('*_bldg_*.gml')):
        for _, element in ET.iterparse(file, events=('end',)):
            if element.tag != '{' + ns['b'] + '}Building':
                continue
            identity = element.attrib.get('{' + ns['g'] + '}id')
            roof = element.find('b:lod0RoofEdge', ns)
            if roof is None:
                roof = element.find('b:lod0FootPrint', ns)
            solid = element.find('b:lod1Solid', ns)
            if roof is not None and solid is not None and identity not in seen:
                footprint = unary_union(read_polygons(roof))
                if footprint.intersects(extent):
                    heights = [positions(p)[:, 2].max() for p in solid.findall('.//g:posList', ns)]
                    if heights:
                        for poly in polygons(make_valid(footprint.simplify(2, preserve_topology=True)).intersection(extent)):
                            if poly.area > 1:
                                result.append((identity, poly, float(max(heights))))
                    seen.add(identity)
            element.clear()
        print('Western buildings:', file.name, len(result), flush=True)
    return result

config = json.loads((args.model_root / 'deliverables/output_road_aware_print_v11/map_config.json').read_text())
x0, y0 = config['original_projected_bounds_m'][:2]
scale = 1000 / config['scale_denominator']
extent = box(x0 + (-1200 - 30) / scale, y0 + (-30 - 30) / scale,
             x0 + (-18 - 30) / scale, y0 + (1380 - 30) / scale)

def local(geometry, tolerance=2):
    geometry = affinity.translate(geometry, xoff=-x0, yoff=-y0)
    geometry = affinity.scale(geometry, xfact=scale, yfact=scale, origin=(0, 0))
    return affinity.translate(geometry, xoff=30, yoff=30).simplify(tolerance, preserve_topology=True)

water = read_water(extent)
roads = []
for file in sorted((args.model_root / 'source').glob('*_tran_*.gml')):
    for _, element in ET.iterparse(file, events=('end',)):
        if element.tag != '{http://www.opengis.net/citygml/transportation/2.0}Road':
            continue
        for polygon in read_polygons(element):
            if polygon.intersects(extent):
                roads.append(polygon.intersection(extent))
        element.clear()
    print('Western roads:', file.name, flush=True)
buildings = sorted(read_buildings(extent), key=lambda b: b[1].area, reverse=True)[:450]
output = {
    'bounds': [-1200, -30, -18, 1380],
    'water': mapping(local(water)),
    'roads': mapping(local(unary_union(roads))),
    'buildings': [{'geometry': mapping(local(poly, 1.5)), 'height': max(2, min(18, (top - 5) * scale * 0.5))}
                  for _, poly, top in buildings],
    'attribution': 'Project PLATEAU / Fukuoka City, simplified west extension; building survey 2022.',
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, separators=(',', ':')))
print('Static west geometry:', len(buildings), 'buildings,', args.output.stat().st_size, 'bytes')
