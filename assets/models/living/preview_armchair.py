"""Inspect every unchanged sitting sample against the saved armchair model."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(candidate):
    if not bpy.app.background or not candidate.is_absolute():
        raise ValueError('Use background Blender and an absolute candidate directory')
    model = candidate/'armchair-authoring.blend'
    original = json.loads((candidate/'proof.json').read_text())
    if original['state'] != 'complete' or digest(model) != original['model_sha256']:
        raise ValueError('Incomplete or changed empty model')
    for name, expected in original['inputs'].items():
        if digest(BASE.parent/name) != expected:
            raise ValueError(f'Empty model input changed: {name}')
    destination = candidate/'occupied-review'
    destination.mkdir(exist_ok=False)
    signature = {str(path): digest(path) for path in (Path(__file__), model, candidate/'proof.json')}
    proof = {'state': 'running', 'scope': 'Unreviewed green sitting checkpoint',
             'signature': signature, 'blender_version': bpy.app.version_string,
             'blender_build_hash': bpy.app.build_hash.decode(), 'renders': []}
    journal = destination/'proof.json'

    def save():
        journal.write_text(json.dumps(proof, indent=2)+'\n')

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        root = bpy.data.objects['ARMCHAIR_MODEL_ROOT']
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        bpy.data.collections['Preserved Sim reference - hidden'].hide_render = False
        rig.animation_data.action = bpy.data.actions['sit']
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            # Armchair local -X and the unchanged Sim's local -Y must face together.
            rig.rotation_euler.z = math.radians(degrees-90)
            for frame in range(1, 5):
                scene.frame_set(frame)
                bpy.context.view_layer.update()
                output = destination/f'sit-{facing}-{frame-1}.png'
                scene.render.filepath = str(output)
                bpy.ops.render.render(write_still=True)
                proof['renders'].append({'facing': facing, 'frame': frame-1,
                                         'path': output.name, 'sha256': digest(output)})
                save()
        if any(digest(Path(name)) != expected for name, expected in signature.items()):
            raise ValueError('Checkpoint inputs changed during rendering')
        proof['state'] = 'complete'
        save()
    except Exception:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1:
        raise ValueError('Pass one absolute candidate directory')
    run(Path(args[0]))
