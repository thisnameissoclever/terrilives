"""Measure and render an occupied pilot without editing the approved Sim file."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent/'kitchen')]
from check_stove_scene import bounds

TRANSLATION = (0, -.50151527, 0)


def run(model, output):
    assert bpy.app.background
    output.mkdir(parents=True, exist_ok=False)
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    result = {'state': 'running', 'model_sha256': before,
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'canonical_translation': TRANSLATION, 'samples': [],
              'acceptance': 'Unreviewed contact probe, not production artwork'}
    def save():
        (output/'proof.json').write_text(json.dumps(result, indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root = bpy.data.objects['BUNK_MODEL_ROOT']
        collection = bpy.data.collections['Preserved Sim reference - hidden']
        collection.hide_render = False
        rig.animation_data.action = bpy.data.actions['sleep']
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        rig.location = TRANSLATION
        for frame in range(1, 5):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            visible = [obj for obj in collection.objects
                       if obj.type == 'MESH' and not obj.hide_render]
            measured = {obj.name: [list(v) for v in bounds(obj)] for obj in visible}
            low = [min(pair[0][i] for pair in measured.values()) for i in range(3)]
            high = [max(pair[1][i] for pair in measured.values()) for i in range(3)]
            result['samples'].append({'frame':frame, 'bounds':[low, high], 'parts':measured})
        # Pilot includes the full physical scene so bedding intersections
        # remain visible rather than being hidden by an arbitrary 2D layer.
        scene.frame_set(1)
        root.rotation_euler.z = math.pi/2
        rig.rotation_euler.z = math.pi/2
        rig.location = root.rotation_euler.to_matrix() @ Vector(TRANSLATION)
        bpy.context.view_layer.update()
        scene.render.filepath = str(output/'sleep-SE-0-beauty.png')
        bpy.ops.render.render(write_still=True)
        result['render_sha256'] = hashlib.sha256(Path(scene.render.filepath).read_bytes()).hexdigest()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == before
        result['state'] = 'complete'
        save()
    except Exception:
        result.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass saved bunk scene and a new probe directory')
    run(*map(Path, args))
