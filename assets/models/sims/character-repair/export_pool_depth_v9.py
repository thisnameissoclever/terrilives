"""Trace registered pool depth from the source model and published opacity."""

import argparse
import json
import math
from pathlib import Path
import sys
import tomllib

import bpy
from mathutils import Matrix, Vector
import numpy as np
BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
sys.path.insert(0, str(BASE))
from depth_geometry import digest, sample

REGISTRATION = {
    'offlinePool': ([2, 2], (0, 0), 2),
    'offlinePoolRectangular': ([3, 2], (0, -.5), 3),
    'offlinePoolLodge': ([4, 3], (.5, -1), 4),
    'offlinePoolInGround': ([7, 5], (0, 0), 6),
}
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def opacity(pages, atlas, row):
    image = bpy.data.images.load(str(pages / atlas['pages'][row['page']]), check_existing=False)
    try:
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        x, y, w, h = (row[key] for key in ('x', 'y', 'w', 'h'))
        return np.flipud(pixels.reshape(height, width, 4))[y:y+h, x:x+w, 3].copy()
    finally:
        bpy.data.images.remove(image)


def export(source, prefix, atlas_path, pages, output):
    atlas = tomllib.loads(atlas_path.read_text(encoding='utf-8'))
    rows = {row['name']: row for row in atlas['sprite']}
    model = source / 'pool-authoring.blend'
    proof_path = source / 'proof.json'
    proof = json.loads(proof_path.read_bytes())
    if proof['state'] != 'complete' or digest(model) != proof['model_sha256']:
        raise ValueError('The pool authoring file differs from the completed color export')
    footprint, origin, depth_range = REGISTRATION[prefix]
    if proof['model_checks']['footprint'] != footprint:
        raise ValueError('The pool footprint differs from the registered color export')
    if {row['facing']: row['degrees'] for row in proof['renders']} != FACINGS:
        raise ValueError('The pool color export uses unexpected facing rotations')

    bpy.ops.wm.open_mainfile(filepath=str(model), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    root = bpy.data.objects['POOL_MODEL_ROOT']
    data = bpy.data.cameras.new('Registered pool depth camera')
    data.type = 'ORTHO'
    data.ortho_scale = proof['ortho_scale']
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    camera.matrix_world = Matrix(proof['camera_matrix'])
    scene.camera = camera
    width, height = proof['logical_canvas']
    scene.render.resolution_x = width * proof['source_density']
    scene.render.resolution_y = height * proof['source_density']
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    for obj in root.children_recursive:
        obj.hide_render = bool(obj.get('pool_rail_authoring_path'))

    output.mkdir(parents=True, exist_ok=False)
    sprites = []
    for facing, degrees in FACINGS.items():
        name = prefix + ('' if facing == 'SE' else facing)
        row = rows[name]
        density = row.get('pixel_density', 1)
        if (row['w'], row['h'], density) != (width * 2, height * 2, 2):
            raise ValueError(f'The atlas rectangle differs from the registered canvas for {name}')
        root.rotation_euler.z = math.radians(degrees)
        root.location = root.rotation_euler.to_matrix() @ Vector((-origin[0], -origin[1], 0))
        bpy.context.view_layer.update()
        alpha = opacity(pages, atlas, row)
        rgba, metrics, _, _ = sample(
            root.children_recursive, row['w'], row['h'], alpha > 0,
            max_edge_distance=3 + math.sqrt(.5), depth_range=depth_range)
        metrics['coveredPixels'] = metrics['opaquePixels']
        metrics['opaquePixels'] = int((alpha >= .5).sum())
        path = output / f'{facing}.rgba'
        path.write_bytes(rgba.tobytes())
        sprites.append(dict(name=name, facing=facing, source=prefix, depthRange=depth_range,
                            pixelDensity=density, w=row['w'], h=row['h'],
                            coverageRule='published-alpha-greater-than-zero',
                            filterSupportPixels=3, path=path.name, sha256=digest(path), **metrics))
        print(f'{name} depth complete', flush=True)
    producers = (Path(__file__), BASE / 'depth_geometry.py', BASE / 'fixture_depth_encoding.py')
    report = dict(state='complete', modelSha256=proof['model_sha256'], proofSha256=digest(proof_path),
                  producerHashes={path.name: digest(path) for path in producers}, sprites=sprites)
    (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--color', type=Path, required=True)
    parser.add_argument('--prefix', choices=REGISTRATION, required=True)
    parser.add_argument('--atlas', type=Path, default=ROOT / 'assets/sprites/atlas.toml')
    parser.add_argument('--pages', type=Path, default=ROOT / 'web/public')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    export(args.color, args.prefix, args.atlas, args.pages, args.output)
