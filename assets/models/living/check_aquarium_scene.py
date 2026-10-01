"""Check the saved cabinet, pane supports and contained aquatic geometry."""
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from aquarium_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from check_aquarium_visibility import check as visibility


def validate():
    bpy.context.view_layer.update()
    root = next(o for o in bpy.data.objects if o.name.startswith('AQUARIUM') and o.name.endswith('_MODEL_ROOT'))
    assert root.location.length < 1e-6 and sum(abs(v) for v in root.rotation_euler) < 1e-6, 'Root registration changed'
    objects = {o.name: o for o in root.children}
    expected = {p['name'] for p in parts()}
    expected.update(f'Rock {i}' for i in range(4))
    expected.update(f'Plant {i} blade {j}' for i in range(2) for j in range(5))
    expected.update(name+suffix for name in ('Amber fish', 'Blue fish', 'Coral fish')
                    for suffix in (' body', ' tail', ' eye -1', ' eye 1'))
    assert set(objects) == expected, 'Aquarium part inventory changed'
    deps = bpy.context.evaluated_depsgraph_get()
    trees, limits = {}, {}
    for name, obj in objects.items():
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        vertices = [evaluated.matrix_world @ v.co for v in data.vertices]
        assert vertices, 'Empty part'
        assert all(abs(v.x) <= .5 and abs(v.y) <= .5 and v.z >= -1e-6 for v in vertices), 'Part leaves tile or floor'
        topology = bmesh.new(); topology.from_mesh(data)
        if name.startswith('Glass '):
            assert len(topology.faces) == 1 and len(topology.verts) == 4, 'Glass pane must be a single supported sheet'
        else:
            assert all(edge.is_manifold for edge in topology.edges), f'{name} is not closed'
        assert all(face.calc_area() > 1e-12 for face in topology.faces), f'{name} has collapsed faces'
        topology.verts.ensure_lookup_table()
        visited, queue = set(), [topology.verts[0]]
        while queue:
            vertex = queue.pop()
            if vertex in visited: continue
            visited.add(vertex)
            queue.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
        assert len(visited) == len(topology.verts), f'{name} is disconnected'
        topology.free()
        trees[name] = BVHTree.FromPolygons(vertices, [tuple(face.vertices) for face in data.polygons])
        limits[name] = [tuple(min(v[i] for v in vertices) for i in range(3)),
                        tuple(max(v[i] for v in vertices) for i in range(3))]
        evaluated.to_mesh_clear()
    assert abs(limits['Cabinet plinth'][0][2]) < 1e-6, 'Cabinet floats'
    pairs = [('Cabinet body', 'Cabinet plinth'), ('Cabinet top', 'Cabinet body'),
             ('Tank base', 'Cabinet top'), ('Substrate', 'Tank base')]
    for side in ('left', 'right'):
        pairs += [(side+' cabinet door', 'Cabinet body'), (side+' door handle', side+' cabinet door')]
    for name in objects:
        if name.startswith(('Glass ', 'Tank corner ')):
            pairs += [(name, 'Tank base'), (name, 'Tank lid')]
        elif name.startswith(('Rock ', 'Plant ')):
            pairs.append((name, 'Substrate'))
        elif 'fish' in name and not name.endswith(' body'):
            pairs.append((name, name.split(' fish')[0]+' fish body'))
    contacts = []
    for a, b in pairs:
        overlap = trees[a].overlap(trees[b])
        witness = None if overlap else overlap_witness(objects[a], objects[b], deps)
        assert overlap or witness, f'{a} detached from {b}'
        contacts.append({'parts': [a, b], 'crossings': len(overlap), 'contained_point': witness})
    # The authored -90-degree turn swaps the tank's width and depth.
    left, right = limits['Glass long -0.341'][0][0], limits['Glass long 0.341'][1][0]
    for name in objects:
        if 'fish' not in name: continue
        low, high = limits[name]
        assert left < low[0] and high[0] < right and -.398 < low[1] and high[1] < .398, 'Fish escapes glass'
        assert .78 < low[2] and high[2] < limits['Tank lid'][0][2], 'Fish escapes water column'
    rows = visibility()
    assert all(row['lid_blocked_vertices'] == 0 for row in rows), 'Lid blocks fish'
    root.rotation_euler.z = 0
    return {'state': 'passed', 'parts': len(objects), 'contacts': contacts, 'visibility': rows}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with an absolute model and a new result path')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(model))
    result = validate()
    result['model_sha256'] = before
    assert hashlib.sha256(model.read_bytes()).hexdigest() == before
    output.write_text(json.dumps(result, indent=2)+'\n')
