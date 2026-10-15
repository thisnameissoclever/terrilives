"""Export the accepted rig for a local mesh-rendering proof without saving it."""
from array import array
import hashlib
import json
from pathlib import Path
import sys
import struct
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parent
SOURCE = BASE.parent / 'sim-01' / 'sim-01-rigged.blend'
OUT = BASE / 'export-v2'
STENCILS = {}
PARITY = []


def matrix(value):
    return [float(value[row][col]) for col in range(4) for row in range(4)]


def group(name):
    regions = {
        'Warm ochre skin': 0, 'Cheek warmth': 0,
        'Chestnut hair planes': 1, 'Original chestnut brow': 1,
        'Washed sage overshirt': 2, 'Sage seam and cuff': 2,
        'Sage folded collar fabric': 2, 'Oatmeal undershirt': 2,
        'Slate cotton trousers': 3, 'Trouser cuff': 3,
        'Warm charcoal shoes': 4, 'Quiet rubber soles': 4,
    }
    return regions.get(name, 5)


def material_data(mat):
    nodes = list(mat.node_tree.nodes) if mat.use_nodes else []
    ramp = next((n.color_ramp for n in nodes if n.type == 'VALTORGB'), None)
    if ramp and (ramp.color_mode != 'RGB' or ramp.interpolation not in ('CONSTANT', 'LINEAR', 'EASE') or len(ramp.elements) > 4):
        raise ValueError(f'Unsupported material ramp: {mat.name}')
    emission = next((n for n in nodes if n.type == 'EMISSION'), None)
    colour = list(emission.inputs['Color'].default_value) if emission else list(mat.diffuse_color)
    return dict(name=mat.name, group=group(mat.name),
                unlit=ramp is None, colour=colour, interpolation=ramp.interpolation if ramp else 'LINEAR',
                ramp=[dict(position=e.position, colour=list(e.color)) for e in ramp.elements] if ramp else [])


def region(obj):
    if obj.name == 'PROOF_BOB':
        return 9
    if obj.get('proof_fixture'):
        return 10
    name = obj.name.lower()
    if any(x in name for x in ('book', 'printed')):
        return 7
    if 'hair' in name:
        return 8
    if any(x in name for x in ('shoe', 'sole')):
        return 6
    if any(x in name for x in ('trouser', 'hip bridge')):
        return 3
    if any(x in name for x in ('forearm', 'palm', 'thumb', 'sleeve', 'cuff')):
        return 4
    if any(g.name == 'head' for g in obj.vertex_groups) and len(obj.vertex_groups) == 1:
        return 1
    return 2


def export_meshes(objects, bones, materials, label):
    vertices, indices, parts = array('f'), array('I'), []
    cage, ranges, coefficients = array('f'), array('I'), bytearray()
    bone_ids = {b.name: i for i, b in enumerate(bones)}
    for obj in objects:
        stencil = None
        if any(mod.type == 'SUBSURF' for mod in obj.modifiers):
            if obj.name not in STENCILS:
                from subdivision import extract, source_pose_parity
                stencil = extract(obj)
                STENCILS[obj.name] = stencil
                PARITY.extend(source_pose_parity(obj, stencil, bpy.data.objects['SIM_01_SHARED_RIG'],
                                                [('idle', 1), ('walk', 4), ('read', 1)]))
            stencil = STENCILS[obj.name]
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
        mesh.calc_loop_triangles()
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        groups = {g.index: bone_ids[g.name] for g in obj.vertex_groups if g.name in bone_ids}
        def influences(v):
            weights = sorted(((groups[g.group], g.weight) for g in v.groups
                              if g.group in groups and g.weight > 0), key=lambda x: -x[1])[:4]
            if not weights:
                raise ValueError(f'Missing weights: {obj.name}/{v.index}')
            total = sum(w for _, w in weights)
            return ([j for j, _ in weights] + [0]*(4-len(weights)),
                    [w/total for _, w in weights] + [0]*(4-len(weights)))
        cage_start = len(cage)//16
        for v in (obj.data.vertices if stencil else mesh.vertices):
            joints, values = influences(v)
            cage.extend([*(obj.matrix_world@v.co), *(normal_matrix@v.normal).normalized(),
                         *joints, *values, 0, region(obj)])
        table, start = {}, len(indices)
        for tri in mesh.loop_triangles:
            mat = obj.data.materials[tri.material_index]
            mid = materials.index(mat)
            for vi in tri.vertices:
                key = (vi, mid)
                if key not in table:
                    v = mesh.vertices[vi]
                    position = obj.matrix_world @ v.co
                    normal = (normal_matrix @ v.normal).normalized()
                    joints, values = influences(v)
                    table[key] = len(vertices) // 16
                    vertices.extend([*position, *normal, *joints, *values, mid, region(obj)])
                    row = stencil['rows'][vi] if stencil else [(vi, 1.)]
                    ranges.extend([len(coefficients)//8, len(row), cage_start+vi if not stencil else 0, int(stencil is None)])
                    for source, weight in row:
                        coefficients.extend(struct.pack('<If', cage_start+source, weight))
                indices.append(table[key])
        parts.append(dict(name=obj.name, start=start, count=len(indices)-start, region=region(obj),
                          outline=not any(x in obj.name.lower() for x in ('eye', 'pupil', 'iris', 'lid', 'smile', 'printed'))))
        evaluated.to_mesh_clear()
    if sys.byteorder != 'little':
        vertices.byteswap()
        indices.byteswap()
        cage.byteswap()
        ranges.byteswap()
    vp, ip = f'{label}.vertices.bin', f'{label}.indices.bin'
    (OUT / vp).write_bytes(vertices.tobytes())
    (OUT / ip).write_bytes(indices.tobytes())
    neighbours = [[] for _ in range(len(vertices)//16)]
    for i in range(0, len(indices), 3):
        for v in indices[i:i+3]:
            neighbours[v].append(i//3)
    normal_ranges, normal_triangles = array('I'), array('I')
    for row in neighbours:
        normal_ranges.extend([len(normal_triangles), len(row)])
        normal_triangles.extend(row)
    buffers = dict(cage=cage.tobytes(), stencilRanges=ranges.tobytes(), stencilWeights=bytes(coefficients),
                   normalRanges=normal_ranges.tobytes(), normalTriangles=normal_triangles.tobytes())
    extra = {}
    for key, data in buffers.items():
        name = f'{label}.{key}.bin'; (OUT/name).write_bytes(data)
        extra[key] = name; extra[key+'Sha256'] = hashlib.sha256(data).hexdigest()
    return dict(vertices=vp, indices=ip, vertexCount=len(vertices)//16, indexCount=len(indices), parts=parts,
                cageCount=len(cage)//16, coefficientCount=len(coefficients)//8, **extra,
                verticesSha256=hashlib.sha256(vertices.tobytes()).hexdigest(),
                indicesSha256=hashlib.sha256(indices.tobytes()).hexdigest())


def run():
    assert bpy.app.background
    OUT.mkdir(parents=True, exist_ok=True)
    before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    bones = list(rig.data.bones)
    actions, basis_actions = {}, {}
    for action in bpy.data.actions:
        rig.animation_data.action = action
        frames, local_frames = [], []
        for tick in range(int(action.frame_range[0]), int(action.frame_range[1])):
            bpy.context.scene.frame_set(tick)
            frames.append([matrix(rig.pose.bones[b.name].matrix) for b in bones])
            local=[]
            for b in bones:
                posed=rig.pose.bones[b.name].matrix
                rest=b.matrix_local
                if b.parent:
                    posed=rig.pose.bones[b.parent.name].matrix.inverted()@posed
                    rest=b.parent.matrix_local.inverted()@rest
                local.append(matrix(rest.inverted()@posed))
            local_frames.append(local)
        actions[action.name] = frames
        basis_actions[action.name] = local_frames
    rig.animation_data.action = bpy.data.actions['idle']
    bpy.context.scene.frame_set(1)
    sys.path.insert(0, str(BASE))
    from bob import create
    bob = create(bpy.data.materials['Chestnut hair planes'])
    bob.modifiers.new('Proof shared skeleton', 'ARMATURE').object = rig
    # Reuse the existing chair author, including its original dimensions and materials.
    model_root = BASE.parents[1]
    sys.path[:0] = [str(model_root / 'living'), str(model_root / 'kitchen'), str(model_root / 'furniture')]
    from armchair_model import build
    fixture = bpy.data.objects.new('PROOF_CHAIR_ROOT', None)
    bpy.context.collection.objects.link(fixture)
    build(fixture)
    fixture.rotation_euler.z = 1.5707963267948966
    for obj in fixture.children_recursive:
        if obj.type == 'MESH':
            obj['proof_fixture'] = True
            obj.vertex_groups.new(name='root').add(list(range(len(obj.data.vertices))), 1., 'REPLACE')
    bpy.context.view_layer.update()
    objects = sorted((o for o in bpy.data.objects if o.type == 'MESH'
                      and not o.name.endswith('_source_curve') and not o.name.startswith('Sleep closed')),
                     key=lambda o: o.name)
    materials = sorted({m for o in objects for m in o.data.materials if m}, key=lambda m: m.name)
    for obj in objects:
        for mod in obj.modifiers:
            if mod.type == 'ARMATURE':
                mod.show_viewport = False
    bpy.context.view_layer.update()
    original = export_meshes(objects, bones, materials, 'original')
    hair = bpy.data.objects['HAIR_01_TRIPO_CURL']
    modifier = hair.modifiers.new('Proof runtime hair simplification', 'DECIMATE')
    modifier.ratio = .12
    bpy.context.view_layer.update()
    runtime = export_meshes(objects, bones, materials, 'runtime')
    result = dict(version=2, sourceSha256=before, blender=bpy.app.version_string,
                  animationSpace='evaluated-parent-local-delta',
                  fixtureBasis=matrix(fixture.matrix_world), fixtureModel='armchair',
                  bones=[dict(name=b.name, parent=bones.index(b.parent) if b.parent else -1,
                              head=list(b.head_local), tail=list(b.tail_local),
                              rest=matrix(b.matrix_local), inverseRest=matrix(b.matrix_local.inverted())) for b in bones],
                  materials=[material_data(m) for m in materials], actions=actions, basisActions=basis_actions,
                  original=original, runtime=runtime)
    (OUT / 'manifest.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    (OUT / 'subdivision-parity.json').write_text(json.dumps(dict(state='complete', rows=PARITY,
        operators={name:{k:v for k,v in s.items() if k!='rows'} for name,s in STENCILS.items()}), indent=2), encoding='utf-8')
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != before:
        raise ValueError('Source rig changed')
    (OUT / 'status.json').write_text(json.dumps(dict(state='complete', sourceUnchanged=True,
        originalTriangles=original['indexCount']//3, runtimeTriangles=runtime['indexCount']//3)), encoding='utf-8')


if __name__ == '__main__':
    try:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / 'status.json').write_text(json.dumps(dict(state='running')), encoding='utf-8')
        run()
    except Exception:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / 'status.json').write_text(json.dumps(dict(state='failed', error=traceback.format_exc())), encoding='utf-8')
        raise
