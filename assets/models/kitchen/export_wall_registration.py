"""Measure published kitchen solids for wall-aware physical placement."""
from pathlib import Path
import hashlib
import json

import bpy

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
MODELS = ROOT / 'assets/models'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    catalog = json.loads((MODELS / 'static-props.json').read_text(encoding='utf-8'))
    rows = []
    for entry in catalog['objects']:
        if entry['name'] not in {'offlineCounter', 'offlineSink', 'offlineFridge', 'offlineStove'}:
            continue
        directory = MODELS / entry['directory']
        proof = json.loads((directory / 'proof.json').read_text(encoding='utf-8'))
        sources = list(directory.glob('*.blend'))
        if len(sources) != 1 or digest(sources[0]) != proof['model_sha256']:
            raise ValueError('Published kitchen source does not match its receipt')
        source = sources[0]
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
        root = next(obj for obj in bpy.data.objects if obj.type == 'EMPTY' and obj.name.endswith('_MODEL_ROOT'))
        root.rotation_euler.z = 0
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        points = []
        for obj in root.children_recursive:
            if obj.type != 'MESH':
                continue
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
            evaluated.to_mesh_clear()
        rows.append(dict(sprite=entry['name'], source=source.relative_to(ROOT).as_posix(),
                         sourceSha256=digest(source),
                         minimum=[min(point[axis] for point in points) for axis in range(3)],
                         maximum=[max(point[axis] for point in points) for axis in range(3)]))
    output = dict(version=1, producerSha256=digest(Path(__file__)),
                  coordinateSystem='unrotated Blender fixture-local XYZ', fixtures=rows)
    (BASE / 'wall-registration.json').write_bytes((json.dumps(output, indent=2) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
