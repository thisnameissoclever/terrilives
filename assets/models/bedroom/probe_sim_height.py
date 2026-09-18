"""Measure the approved idle Sim without saving or changing its source model."""
import hashlib
import json
from pathlib import Path
import sys

import bpy


def main(model, output):
    assert bpy.app.background, 'Use background Blender'
    assert not output.exists(), 'Use a new measurement path'
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(model))
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    rig.animation_data.action = bpy.data.actions['idle']
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    bounds = {}
    for name in ('HAIR_01_TRIPO_CURL', 'Sculpted head',
                 'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'):
        obj = bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = obj.to_mesh()
        try:
            points = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
            bounds[name] = [[min(p[i] for p in points) for i in range(3)],
                            [max(p[i] for p in points) for i in range(3)]]
        finally:
            obj.to_mesh_clear()
    sole = min(bounds[name][0][2] for name in bounds if name.startswith('Fitted'))
    hair = bounds['HAIR_01_TRIPO_CURL'][1][2]
    assert hashlib.sha256(model.read_bytes()).hexdigest() == before
    output.write_text(json.dumps({'state': 'complete', 'model_sha256': before,
                                 'action': 'idle', 'frame': 1, 'bounds': bounds,
                                 'sole_min_z': sole, 'hair_max_z': hair,
                                 'sole_to_hair_height': hair-sole}, indent=2)+'\n')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass saved Sim model and a new result path')
    main(*map(Path, args))
