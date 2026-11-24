"""Export a wider pool and its matching editable model, motion and physical fixture."""
from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent
sys.path[:0] = [str(HERE), str(MODELS / 'furniture')]
from pool_activity_model_v5 import build
from pool_activity_layout_v5 import LEFT_RAIL_X, RIGHT_RAIL_X, LEFT_HARDWARE, SUPPORTS, expected_x
from export_pool_fixture_v4 import solid_topology


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def evaluated_fixture(root, rail_centres=(LEFT_RAIL_X, RIGHT_RAIL_X), *,
                      occupied_bounds=((-1, -1), (1, 1))):
    inverse = root.matrix_world.inverted()
    graph = bpy.context.evaluated_depsgraph_get()
    rails, solids = [], []
    for obj in sorted(root.children_recursive, key=lambda item: item.name):
        if (obj.type not in ('MESH', 'CURVE') or obj.name == 'Pool water surface'
                or obj.get('pool_rail_authoring_path')):
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            transform = inverse @ evaluated.matrix_world
            vertices = [list(transform @ v.co) for v in mesh.vertices]
            triangles = [list(t.vertices) for t in mesh.loop_triangles]
            bounds = [[op(v[axis] for v in vertices) for axis in range(3)] for op in (min, max)]
            if any(bounds[0][axis] < occupied_bounds[0][axis]
                   or bounds[1][axis] > occupied_bounds[1][axis] for axis in (0, 1)):
                raise ValueError(f'{obj.name} leaves the pool footprint.')
            solid = {'id': obj.name, 'kind': 'floor' if obj.name == 'Pool basin floor' else 'solid',
                     'vertices': vertices, 'triangles': triangles, 'bounds': bounds}
            if solid['kind'] == 'solid' and not solid_topology(solid)['closedAfterExactCoincidentVertexJoin']:
                raise ValueError(f'{obj.name} is no longer a closed physical solid.')
            solids.append(solid)
        finally:
            evaluated.to_mesh_clear()
        if obj.get('pool_rail_path'):
            path = bpy.data.objects[obj['pool_rail_path']]
            if (path.type != 'CURVE' or not path.hide_render or not path.get('pool_rail_authoring_path')
                    or path.parent != root or path.matrix_world != obj.matrix_world):
                raise ValueError(f'{obj.name} lost its editable rail path: '
                                 f'{path.name}, type={path.type}, hidden={path.hide_render}, '
                                 f'parent={path.parent}, matrix={path.matrix_world!r}, rail={obj.matrix_world!r}')
            transform = inverse @ path.matrix_world
            rails.append({'id': obj.name, 'radius': float(path.data.bevel_depth),
                          'points': [{'point': list(transform @ p.co), 'left': list(transform @ p.handle_left),
                                      'right': list(transform @ p.handle_right)}
                                     for p in path.data.splines[0].bezier_points]})
    if len(rails) != 2 or any(abs(r['points'][0]['point'][0]-x) > 1e-6
                              for r, x in zip(rails, rail_centres)):
        raise ValueError('Evaluated rail centres differ from the authoring model.')
    return solids, rails


def run(args, *, builder=build, model_source='outdoor/pool_activity_model_v5.py', landing_outline=None, producer=__file__):
    fixture = json.loads(args.baseline_fixture.read_bytes())
    motion = json.loads(args.motion.read_bytes())
    if fixture['revisions']['poseProducer'] != digest(args.motion):
        raise ValueError('Baseline contact policy belongs to a different motion file.')
    outputs = [args.output / name for name in ('pool-authoring.blend', 'motion.json', 'contacts.json')]
    if any(p.exists() for p in outputs):
        raise ValueError('Use a fresh candidate output directory.')
    args.output.mkdir(parents=True, exist_ok=True)
    # Furniture materials inherit the line-art ramps from the character source.
    bpy.ops.wm.open_mainfile(filepath=str(MODELS / 'sims/sim-01/sim-01-rigged.blend'),
                             load_ui=False, use_scripts=False)
    scene = bpy.data.scenes.new('Wider pool ladder')
    bpy.context.window.scene = scene
    root = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    scene.collection.objects.link(root)
    checks = builder(root)
    solids, rails = evaluated_fixture(root)
    original = {s['id']: s for s in fixture['solids']}
    if set(original) != {s['id'] for s in solids}:
        raise ValueError('Pool physical ownership changed.')
    for solid in solids:
        name = solid['id']
        prior = original[name]
        if name == 'Pool ladder crest landing' and landing_outline is not None:
            top = prior['bounds'][1][2]
            expected = [(x,y,z) for z in (prior['bounds'][0][2],top) for x,y in landing_outline()]
            if len(expected) != len(solid['vertices']) or any(
                    max(abs(a-b) for a,b in zip(v,w)) > 1e-6 for v,w in zip(solid['vertices'], expected)):
                raise ValueError('The physical landing differs from the visible beveled outline.')
            surface_ids = [i for i,triangle in enumerate(solid['triangles'])
                           if all(abs(solid['vertices'][v][2]-top) < 1e-6 for v in triangle)]
            if len(surface_ids) != len(landing_outline())-2:
                raise ValueError('Incomplete upper landing triangulation.')
            for clip in fixture['clips'].values():
                for row in [*clip['samples'],*clip['intervals']]:
                    for limb,record in row['limbs'].items():
                        if record['surface'] == name:
                            if limb != 'footR' or record['region']['kind'] != 'top-face':
                                raise ValueError('The landing cut requires the established right-sole support policy.')
                            record['region'] = {'kind':'top-face','triangles':surface_ids}
            continue
        if solid['triangles'] != prior['triangles']:
            raise ValueError(f'{name} changed triangle identity under the retained contact policy.')
        if name not in LEFT_HARDWARE and name not in SUPPORTS and solid != prior:
            raise ValueError(f'Unchanged pool solid differs: {name}')
        for old, new in zip(prior['vertices'], solid['vertices'], strict=True):
            if old[1:] != new[1:]:
                raise ValueError(f'{name} changed its vertical or basinward support geometry.')
            if abs(new[0] - expected_x(name, old[0])) > 1e-6:
                raise ValueError(f'{name} does not match its declared rail or tread displacement.')
    bpy.ops.wm.save_as_mainfile(filepath=str(outputs[0]), check_existing=False)
    motion['modelSource'] = model_source
    motion['derivation']['ladder'] = 'Left rail at -0.80 m. Right crest grip and both ladder flights retain their source heights.'
    outputs[1].write_bytes((json.dumps(motion, indent=2) + '\n').encode())
    fixture.update(solids=solids, rails=rails, waterHeight=checks['water_z'])
    fixture['revisions'].update(model=digest(outputs[0]), producer=digest(Path(producer)), poseProducer=digest(outputs[1]),
                                clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    outputs[2].write_bytes((json.dumps(fixture, separators=(',', ':')) + '\n').encode())
    print(json.dumps({p.name: digest(p) for p in outputs}))


if __name__ == '__main__':
    parser = ArgumentParser()
    for field in ('baseline-fixture', 'motion', 'output'):
        parser.add_argument('--'+field, type=Path, required=True)
    run(parser.parse_args(sys.argv[sys.argv.index('--')+1:]))
