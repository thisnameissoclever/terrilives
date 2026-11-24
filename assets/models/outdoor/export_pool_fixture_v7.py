"""Export the inward turning platform and bind each sole to its actual upper faces."""
from argparse import ArgumentParser
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent
sys.path[:0] = [str(HERE), str(MODELS / 'furniture')]
from export_pool_fixture_v5 import digest, evaluated_fixture
from pool_activity_model_v7 import build
import pool_activity_layout_v7 as layout
from hashlib import sha256


def top_faces(solid):
    vertices = solid['vertices']
    top = solid['bounds'][1][2]
    return [i for i, triangle in enumerate(solid['triangles'])
            if all(vertices[v][2] == top for v in triangle)]


def export(source, output):
    motion_path = source / 'pool_activity_motion_v19.json'
    fixture = json.loads((source / 'contacts-v8.json').read_bytes())
    motion = json.loads(motion_path.read_bytes())
    template = json.loads((source / 'ladder-climb-out-v2.poolroute').read_bytes())
    revision = fixture['revisions']
    if (revision['poseProducer'] != digest(motion_path) or template['motion'] != revision['poseProducer']
            or template['model'] != revision['model'] or template['version'] != 2):
        raise ValueError('The starting contact policy, recipe and motion must be a matched inward climb.')
    output.mkdir(parents=True, exist_ok=False)
    bpy.ops.wm.open_mainfile(filepath=str(MODELS/'sims/sim-01/sim-01-rigged.blend'), load_ui=False, use_scripts=False)
    scene = bpy.data.scenes.new('Pool turning platform')
    bpy.context.window.scene = scene
    root = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    scene.collection.objects.link(root)
    checks = build(root)
    solids, rails = evaluated_fixture(root, layout.LADDER_RAIL_X)
    by_name = {s['id']:s for s in solids}
    original = {s['id']:s for s in fixture['solids']}
    if original.keys() != by_name.keys() or by_name['Pool basin floor'] != original['Pool basin floor']:
        raise ValueError('Pool basin or hardware ownership changed.')
    deck = by_name['Pool ladder crest landing']
    x0, x1 = layout.LADDER_RAIL_X
    for corner, expected in zip(deck['bounds'], [(x0,layout.LANDING_INNER_Y,.975),(x1,layout.LANDING_OUTER_Y,1.)]):
        if any(abs(a-b)>1e-6 for a,b in zip(corner,expected)):
            raise ValueError('The exported landing differs from the selected turn dimensions.')
    for clip in fixture['clips'].values():
        for row in [*clip['samples'],*clip['intervals']]:
            for limb, record in row['limbs'].items():
                name = record['surface']
                region = record['region']
                if name not in by_name or not region or region['kind'] != 'top-face':
                    continue
                if not limb.startswith('foot') or region.get('triangles') != top_faces(original[name]):
                    raise ValueError(f'The source policy does not own the complete top of {name}.')
                new_faces = top_faces(by_name[name])
                if not new_faces:
                    raise ValueError(f'Missing installed top faces for {name}.')
                record['region'] = {'kind':'top-face','triangles':new_faces}
    model_path = output/'pool-authoring.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(model_path), check_existing=False)
    motion['modelSource'] = 'outdoor/pool_activity_model_v7.py'
    motion['derivation']['ladder'] = '48 cm internal landing and 65.4 cm clear rail opening for the inward-facing descent.'
    motion_bytes = (json.dumps(motion,indent=2)+'\n').encode()
    motion_sha = sha256(motion_bytes).hexdigest()
    model_sha = digest(model_path)
    revision.update(model=model_sha,poseProducer=motion_sha,producer=digest(Path(__file__)),
                    clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    fixture.update(solids=solids,rails=rails,waterHeight=checks['water_z'])
    template.update(model=model_sha,motion=motion_sha)
    (output/'motion.json').write_bytes(motion_bytes)
    (output/'contacts.json').write_bytes(json.dumps(fixture,separators=(',',':')).encode())
    (output/'ladder-climb-out.poolroute').write_bytes(json.dumps(template,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode())
    print(json.dumps({p.name:digest(p) for p in output.iterdir() if p.is_file()}))


if __name__ == '__main__':
    parser=ArgumentParser()
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    options=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    export(options.source,options.output)
