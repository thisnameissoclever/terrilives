"""Evaluate the compact complete-cycle candidate fixture without replacing registered artwork or motion."""
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
sys.path[:0] = [str(BASE), str(MODELS/'furniture'), str(MODELS/'sims/character-creator')]
from pool_activity_model_v4 import build
from pool_activity_policy_v9 import build_clips
from mathutils.geometry import intersect_ray_tri


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


def solid_topology(solid):
    ids={};mapped=[];edges={}
    for vertex in solid['vertices']:
        key=tuple(vertex)
        if key not in ids:ids[key]=len(ids)
        mapped.append(ids[key])
    positions=list(ids)
    for triangle in solid['triangles']:
        for a,b in zip(triangle,triangle[1:]+triangle[:1]):
            key=tuple(sorted((mapped[a],mapped[b])))
            edges[key]=edges.get(key,0)+1
    bad=[{'vertices':[positions[a],positions[b]],'incidentTriangles':count} for (a,b),count in edges.items() if count!=2]
    return {'solid':solid['id'],'closedAfterExactCoincidentVertexJoin':not bad,'nonManifoldEdges':len(bad),'witnesses':bad[:8]}


def retained_wall(path):
    bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False,use_scripts=False)
    obj=bpy.data.objects['Pool wall'];evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
    try:
        solid={'id':obj.name,'vertices':[list(obj.matrix_world@v.co) for v in mesh.vertices],
               'triangles':[list(triangle.vertices) for triangle in mesh.loop_triangles]}
        result={'modelSha256':digest(path),**solid_topology(solid)}
        if result['closedAfterExactCoincidentVertexJoin']:
            raise ValueError('Retained Boolean wall no longer rejects the unchanged closedness check')
        return result
    finally:
        evaluated.to_mesh_clear()


def run(args, runtime):
    output, model, source_path = map(Path, (args.output, args.model, args.source))
    if output.exists() or model.exists():
        raise ValueError('Candidate geometry requires fresh ignored outputs')
    baseline=retained_wall(Path(args.baseline_model)) if args.baseline_model else None
    source = json.loads(source_path.read_text())
    if digest(source_path) != '31fe895dad1b562c9d9cfe921aaa29dc30c283443287f093ae6d6b219c4716b5':
        raise ValueError('Candidate source0 gauge identity changed')
    rig = MODELS/'sims/sim-01/sim-01-rigged.blend'
    if digest(rig) != source['sourceRigSha256']:
        raise ValueError('Actual source rig identity changed')
    bpy.ops.wm.open_mainfile(filepath=str(rig), load_ui=False, use_scripts=False)
    scene = bpy.data.scenes.new('compact complete-cycle fitted pool candidate')
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
    def support(surface=None, kind='support', interval=None):
        if surface is None:
            return {'mode': 'free', 'surface': None, 'interval': None, 'intervalSpace': 'clip-phase', 'region': None}
        if surface.startswith('Pool ladder rail '):
            region = {'kind': 'rail', 'parameter': [1., 5.]}
        elif surface == 'ground:approach':
            region = {'kind': 'top-face'}
        else:
            solid = by_id[surface]
            indices = []
            for index, triangle in enumerate(solid['triangles']):
                a,b,c = [Vector(solid['vertices'][i]) for i in triangle]
                normal = (b-a).cross(c-a)
                if normal.length and normal.normalized().z > .999999:
                    indices.append(index)
            region = {'kind': 'top-face', 'triangles': indices}
        return {'mode': kind, 'surface': surface, 'interval': interval, 'intervalSpace': 'clip-phase', 'region': region}
    motion_path=MODELS/'sims/character-creator/pool_activity_motion_v9.json'
    motion=json.loads(motion_path.read_text())
    clips=build_clips(motion,support)
    records=clips['pool_enter']['samples']
    bounds=[[min(v[i] for solid in solids for v in solid['vertices']) for i in range(3)],
            [max(v[i] for solid in solids for v in solid['vertices']) for i in range(3)]]
    if any(bounds[0][i]<-1 or bounds[1][i]>1 for i in [0,1]):
        raise ValueError('Actual compact solid leaves the owned square')
    topology=[]
    for solid in solids:
        if solid['kind']=='floor':continue
        record=solid_topology(solid)
        topology.append(record)
        if solid['id']=='Pool wall' and not record['closedAfterExactCoincidentVertexJoin']:
            raise ValueError('Recessed pool wall is not closed: '+json.dumps(record,separators=(',',':')))
    wall=by_id['Pool wall'];lining=[]
    for z in [.30,.55,.80]:
        origin=Vector((-.5,.70,z));direction=Vector((0,1,0));hits=[]
        for triangle in wall['triangles']:
            hit=intersect_ray_tri(*(Vector(wall['vertices'][i]) for i in triangle),direction,origin,True)
            if hit is not None and hit.y>=origin.y:hits.append(float(hit.y))
        ys=sorted(set(hits))
        if len(ys)!=2 or not ys[0]<ys[1]:
            raise ValueError('Toe recess has no continuous two-faced liner backing')
        lining.append({'x':-.5,'z':z,'actualFrontY':ys[0],'actualBackY':ys[1],'actualThickness':ys[1]-ys[0]})
    fixture = {'version': 1, 'frame': 'pool-local-metres', 'fixtureModel': 'pool', 'waterHeight': checks['water_z'],
               'ground': {'id': 'ground:approach', 'bounds': [[-1.,1.,0.],[0.,2.,0.]]}, 'solids': solids, 'rails': rails,
               'clips': clips,
               'revisions': {'model': digest(model), 'producer': digest(Path(__file__)),
                             'poseProducer': digest(motion_path),
                             'clipLibrary': hashlib.sha256(json.dumps(clips,sort_keys=True,separators=(',',':')).encode()).hexdigest()},
               'coverage': {'geometry': 'actual evaluated candidate Blender triangles, bevels and rail caps', 'waterIsSolid': False}}
    result = {'version': 1, 'status': 'unadmitted complete-cycle compact source fixture; actual geometry and all declared source events',
              'runtime': runtime, 'rejectedWallBaseline': baseline, 'model': str(model), 'modelSha256': digest(model), 'checks': {**checks,'actualBounds':bounds,'topology':topology,'linerSections':lining},
              'source0Sha256': digest(source_path), 'fixture': fixture, 'records': records,
              'sourceFiles': {str(p.relative_to(MODELS)): digest(p) for p in [Path(__file__),BASE/'pool_activity_model_v4.py',BASE/'pool_activity_layout_v4.py',BASE/'pool_activity_rail_v4.py',motion_path,MODELS/'sims/character-creator/pool_activity_policy_v9.py']}}
    output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    return {'state': 'complete', 'sha256': digest(output), 'records': len(records), 'runtime': runtime, 'modelSha256': digest(model)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['source','output','model']:
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--baseline-model')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    status = Path(args.output).with_suffix('.status.json')
    runtime = runtime_evidence()
    status.write_text(json.dumps({'state':'running','runtime':runtime}))
    try:
        status.write_text(json.dumps(run(args,runtime)))
    except Exception:
        status.write_text(json.dumps({'state':'failed','runtime':runtime,'error':traceback.format_exc()}))
        raise

