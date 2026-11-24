"""Evaluate the R60 candidate fixture without replacing registered artwork or motion."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import sys
import traceback
import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.dont_write_bytecode = True
sys.path[:0] = [str(BASE), str(MODELS/'furniture')]
from pool_activity_model_v3 import build


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runtime_evidence():
    text = lambda value: value.decode('utf-8', errors='replace') if isinstance(value, bytes) else value
    binary = Path(bpy.app.binary_path).resolve()
    return {'background': bpy.app.background, 'binaryPath': str(binary), 'binarySha256': digest(binary),
            'version': bpy.app.version_string, 'versionTuple': list(bpy.app.version),
            'build': {name: text(getattr(bpy.app, name)) for name in ['build_hash', 'build_branch', 'build_commit_date', 'build_commit_time', 'build_platform', 'build_type']},
            'argv': list(sys.argv), 'cwd': os.getcwd(), 'pid': os.getpid(),
            'selectedEnvironment': {'PYTHONDONTWRITEBYTECODE': os.environ.get('PYTHONDONTWRITEBYTECODE')}}


def run(args, runtime):
    output, model, source_path = map(Path, (args.output, args.model, args.source))
    if output.exists() or model.exists():
        raise ValueError('Candidate geometry requires fresh ignored outputs')
    source = json.loads(source_path.read_text())
    if digest(source_path) != '31fe895dad1b562c9d9cfe921aaa29dc30c283443287f093ae6d6b219c4716b5':
        raise ValueError('Candidate source0 gauge identity changed')
    rig = MODELS/'sims/sim-01/sim-01-rigged.blend'
    if digest(rig) != source['sourceRigSha256']:
        raise ValueError('Actual source rig identity changed')
    bpy.ops.wm.open_mainfile(filepath=str(rig), load_ui=False, use_scripts=False)
    scene = bpy.data.scenes.new('R60 fitted pool candidate')
    bpy.context.window.scene = scene
    root = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    scene.collection.objects.link(root)
    checks = build(root)
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(model), check_existing=False)
    inverse = root.matrix_world.inverted()
    graph = bpy.context.evaluated_depsgraph_get()
    solids, rails = [], []
    for obj in sorted(root.children_recursive, key=lambda item: item.name):
        if obj.type not in ['MESH', 'CURVE'] or obj.name == 'Pool water surface' or obj.get('pool_rail_authoring_path'):
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        try:
            transform = inverse@obj.matrix_world
            vertices = [list(transform@v.co) for v in mesh.vertices]
            triangles = [list(triangle.vertices) for triangle in mesh.loop_triangles]
            solids.append({'id': obj.name, 'kind': 'floor' if obj.name == 'Pool basin floor' else 'solid',
                           'vertices': vertices, 'triangles': triangles,
                           'bounds': [[min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)]]})
        finally:
            evaluated.to_mesh_clear()
        if obj.name.startswith('Pool ladder rail '):
            path = bpy.data.objects[obj['pool_rail_path']]
            if path.type != 'CURVE' or not path.hide_render or not path.get('pool_rail_authoring_path') or path.parent != root or path.matrix_world != obj.matrix_world:
                raise ValueError('Candidate rail mesh has a different actual path owner')
            points = path.data.splines[0].bezier_points
            transform = inverse@path.matrix_world
            rails.append({'id': obj.name, 'radius': float(path.data.bevel_depth), 'points': [
                {'point': list(transform@p.co), 'left': list(transform@p.handle_left), 'right': list(transform@p.handle_right)} for p in points]})
    by_id = {solid['id']: solid for solid in solids}
    def support(surface=None):
        if surface is None:
            return {'mode': 'free', 'surface': None, 'interval': None, 'intervalSpace': 'clip-phase', 'region': None}
        if surface.startswith('Pool ladder rail '):
            region = {'kind': 'rail', 'parameter': [1., 5.]}
        else:
            solid = by_id[surface]
            indices = []
            for index, triangle in enumerate(solid['triangles']):
                a,b,c = [Vector(solid['vertices'][i]) for i in triangle]
                normal = (b-a).cross(c-a)
                if normal.length and normal.normalized().z > .999999:
                    indices.append(index)
            region = {'kind': 'top-face', 'triangles': indices}
        return {'mode': 'support', 'surface': surface, 'interval': None, 'intervalSpace': 'clip-phase', 'region': region}
    records = []
    for phase, label, left, right, turned in [
        (.16, 'first-rung', 'Pool outside ladder tread 1', 'Pool outside ladder tread 1', False),
        (.31, 'middle-transfer', None, 'Pool outside ladder tread 2', False),
        (.54, 'crest', 'Pool ladder crest landing', 'Pool ladder crest landing', False),
        (.655, 'inside-transfer', None, 'Pool inside ladder tread 4', True)]:
        records.append({'phase': phase, 'label': label, 'travel': phase,
                        'limbs': {'handL': support('Pool ladder rail '+('2' if turned else '1')),
                                  'handR': support('Pool ladder rail '+('1' if turned else '2')),
                                  'footL': support(left), 'footR': support(right)},
                        'rootRegion': {'anchor': 'hips', 'reference': 'authored', 'minimum': [0,0,0], 'maximum': [0,0,0]}})
    fixture = {'version': 1, 'frame': 'pool-local-metres', 'fixtureModel': 'pool', 'waterHeight': checks['water_z'],
               'ground': {'id': 'ground:approach', 'bounds': [[-1.,1.,0.],[0.,2.,0.]]}, 'solids': solids, 'rails': rails,
               'clips': {'pool_enter': {'playback': 'progress', 'samples': records, 'intervals': []}},
               'revisions': {'model': digest(model), 'producer': digest(Path(__file__)),
                             'poseProducer': digest(MODELS/'sims/character-creator/pool_activity_motion_v8.json'),
                             'clipLibrary': hashlib.sha256(json.dumps(records,sort_keys=True,separators=(',',':')).encode()).hexdigest()},
               'coverage': {'geometry': 'actual evaluated candidate Blender triangles, bevels and rail caps', 'waterIsSolid': False}}
    result = {'version': 1, 'status': 'unadmitted R60 geometry-only candidate; four explicit stance source records only',
              'runtime': runtime, 'model': str(model), 'modelSha256': digest(model), 'checks': checks,
              'source0Sha256': digest(source_path), 'fixture': fixture, 'records': records,
              'sourceFiles': {str(p.relative_to(MODELS)): digest(p) for p in [Path(__file__),BASE/'pool_activity_model_v3.py',BASE/'pool_activity_layout_v3.py',BASE/'pool_activity_rail_v3.py',MODELS/'sims/character-creator/pool_activity_motion_v8.json']}}
    output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    return {'state': 'complete', 'sha256': digest(output), 'records': len(records), 'runtime': runtime, 'modelSha256': digest(model)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['source','output','model']:
        parser.add_argument('--'+name,required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    status = Path(args.output).with_suffix('.status.json')
    runtime = runtime_evidence()
    status.write_text(json.dumps({'state':'running','runtime':runtime}))
    try:
        status.write_text(json.dumps(run(args,runtime)))
    except Exception:
        status.write_text(json.dumps({'state':'failed','runtime':runtime,'error':traceback.format_exc()}))
        raise

