"""Export the rectangular pool while retaining the authored contact frame."""
from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent
sys.path[:0] = [str(HERE), str(MODELS/'furniture')]
from export_pool_fixture_v5 import digest, evaluated_fixture
from pool_activity_layout_v9 import ORIGIN_Y, flight
from pool_activity_model_v9 import build


def export(source, output, *, compact=False):
    motion_bytes = (source/'motion.json').read_bytes()
    motion = json.loads(motion_bytes)
    fixture = json.loads((source/'contacts.json').read_bytes())
    family = json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    if (sha256(motion_bytes).hexdigest() != family['motion']
            or family['motion'] != fixture['revisions']['poseProducer']
            or family['model'] != fixture['revisions']['model']):
        raise ValueError('Expected a matched pool motion, fixture, and exit route.')
    output.mkdir(parents=True, exist_ok=False)
    bpy.ops.wm.open_mainfile(
        filepath=str(MODELS/'sims/sim-01/sim-01-rigged.blend'), load_ui=False, use_scripts=False)
    scene = bpy.data.scenes.new('Rectangular outdoor pool')
    bpy.context.window.scene = scene
    root = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    scene.collection.objects.link(root)
    build(root, compact=compact)
    solid_bounds = ((-1, -1 if compact else ORIGIN_Y - 1.5), (1, 1))
    solids, rails = evaluated_fixture(root, flight.LADDER_RAIL_X, occupied_bounds=solid_bounds)
    historical = {solid['id']: solid for solid in fixture['solids']}
    for solid in solids:
        if solid['id'].startswith('Pool ladder') or 'ladder tread' in solid['id']:
            if solid != historical[solid['id']]:
                raise ValueError(f"Exterior pool changed a contact surface: {solid['id']}")
    if rails != fixture['rails']:
        raise ValueError('The rail curves changed in the rectangular pool.')

    motion['modelSource'] = 'outdoor/pool_activity_model_v9.py'
    motion['derivation']['ladder'] = 'The exterior ladder leads to the same turning platform over a rectangular basin.'
    del motion['dryBay']
    motion['rectangularPool'] = 'compact' if compact else 'wide'
    motion['paddle']['centre'][1] = .075 if compact else -.25
    # Motion remains in the ladder's frame. The front of the rectangular
    # liner replaces the old notch as the swimming limit.
    model = output/'pool-authoring.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(model), check_existing=False)
    motion_bytes = (json.dumps(motion, indent=2)+'\n').encode()
    model_sha = digest(model)
    motion_sha = sha256(motion_bytes).hexdigest()
    fixture.update(solids=solids, rails=rails)
    fixture['revisions'].update(model=model_sha, poseProducer=motion_sha, producer=digest(Path(__file__)))
    family.update(model=model_sha, motion=motion_sha)
    (output/'motion.json').write_bytes(motion_bytes)
    (output/'contacts.json').write_text(json.dumps(fixture, separators=(',', ':')), encoding='utf8')
    (output/'ladder-climb-out.poolroute').write_text(json.dumps(family, separators=(',', ':')), encoding='utf8')


if __name__ == '__main__':
    parser = ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--compact', action='store_true')
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    export(arguments.source, arguments.output, compact=arguments.compact)
