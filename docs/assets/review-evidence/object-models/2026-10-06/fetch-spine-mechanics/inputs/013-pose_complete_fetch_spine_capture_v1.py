"""Capture the pinned lower-fetch source without changing pose or geometry."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path, output):
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs'])
    inputs[str(manifest_path)] = digest(manifest_path)
    if output.exists() or not bpy.app.background or any(digest(p) != s for p, s in inputs.items()):
        raise ValueError('Require a new output and unchanged pinned source inputs')
    output.mkdir()
    began = time.monotonic()
    report = dict(state='running', pid=os.getpid(), inputs=inputs, acceptance=False,
                  scope='Unchanged source capture; rejected seed garments remain unaccepted')
    arrays = {}

    def save():
        report['elapsed_seconds'] = time.monotonic() - began
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=manifest['seed_scene'])
        rig = bpy.data.objects[manifest['rig']]
        deps = bpy.context.evaluated_depsgraph_get()
        meshes = {'skin_and_cloth': {}, 'furniture': {}}
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or obj.hide_render:
                continue
            owner = ('skin_and_cloth' if any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers)
                     else 'furniture' if obj.name.startswith(('Back panel', 'Left side', 'Right side', 'Base', 'Shelf ', 'Crown', 'Book '))
                     else None)
            if owner is None:
                continue
            evaluated = obj.evaluated_get(deps)
            mesh = evaluated.to_mesh()
            try:
                mesh.calc_loop_triangles()
                points = np.asarray([list(evaluated.matrix_world @ v.co) for v in mesh.vertices], dtype=np.float64)
                triangles = np.asarray([tuple(t.vertices) for t in mesh.loop_triangles], dtype=np.int32)
                name = obj.get('probe_source_name', obj.name)
                arrays[owner + '/' + name + '/points'] = points
                arrays[owner + '/' + name + '/triangles'] = triangles
                meshes[owner][name] = dict(vertices=len(points), triangles=len(triangles),
                                          low=points.min(0).tolist(), high=points.max(0).tolist())
            finally:
                evaluated.to_mesh_clear()
        report.update(meshes=meshes, rig=rig.name,
                      rig_matrix_world=np.asarray(rig.matrix_world).tolist(),
                      bone_matrices={b.name: np.asarray(b.matrix).tolist() for b in rig.pose.bones},
                      bone_rest={b.name: np.asarray(b.matrix_local).tolist() for b in rig.data.bones},
                      bone_count=len(rig.pose.bones), state='complete')
        if report['bone_count'] != 17 or 'Book 0 0' not in meshes['furniture']:
            raise ValueError('Pinned rig or lowest-left book source is missing')
    except BaseException as error:
        report.update(state='failed', error=repr(error))
        raise
    finally:
        np.savez_compressed(output / 'geometry.npz', **arrays)
        report['geometrySHA256'] = digest(output / 'geometry.npz')
        report['inputs_unchanged'] = all(digest(p) == s for p, s in inputs.items())
        save()


if __name__ == '__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--') + 1:]))
