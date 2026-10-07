"""Replay only the frozen book correction from the explicit immutable original source."""
import collections
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / 'assets/models/sims/sim-01/sim-01-rigged.blend'
sys.path.insert(0, str(HERE))
import audit_sofa_binding as attachment
import continuous_support_patch as continuous
import probe_sofa_witnesses as witness
import sofa_rest_initialization as rest
import book_grip_replay_math as geometry

ARM = ('Relaxed shirt sleeve', 'Turned sleeve cuff', 'Forearm with elbow and wrist sections', 'Relaxed palm', 'Resting thumb')
PROP = ('Reading book cover', 'Reading book pages', 'Printed book line')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def owned(rig):
    return [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]


def visible(objects):
    bpy.context.view_layer.update()
    for obj in objects:
        if not obj.hide_render and not obj.hide_viewport:
            obj.update_tag(refresh={'OBJECT'})
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    return {o.name: witness.Surface(o, deps) for o in objects if not o.hide_render and not o.hide_viewport}


def frame_state(rig, objects):
    return dict(frame=bpy.context.scene.frame_current, action=rig.animation_data.action.name if rig.animation_data and rig.animation_data.action else None,
        rig_matrix_world=[list(row) for row in rig.matrix_world],
        bone_matrices={b.name: [list(row) for row in b.matrix] for b in rig.pose.bones},
        channels={b.name:dict(location=list(b.location), rotation_quaternion=list(b.rotation_quaternion), rotation_euler=list(b.rotation_euler), rotation_mode=b.rotation_mode, scale=list(b.scale)) for b in rig.pose.bones},
        properties=dict(book_visible=rig.get('book_visible'), eyes_closed=rig.get('eyes_closed')),
        visibility={o.name:dict(render=not o.hide_render, viewport=not o.hide_viewport, layer=not o.hide_get()) for o in objects})


def action_identity():
    result = {}
    for action in bpy.data.actions:
        curves = []
        for curve in getattr(action, 'fcurves', []):
            curves.append(curve)
        for layer in getattr(action, 'layers', []):
            for strip in getattr(layer, 'strips', []):
                for bag in getattr(strip, 'channelbags', []):
                    curves.extend(bag.fcurves)
        unique = {curve.as_pointer():curve for curve in curves}
        result[action.name] = [dict(path=c.data_path, index=c.array_index, extrapolation=c.extrapolation,
            keys=[dict(co=list(k.co), left=list(k.handle_left), right=list(k.handle_right), interpolation=k.interpolation,
                       left_type=k.handle_left_type, right_type=k.handle_right_type) for k in c.keyframe_points]) for c in unique.values()]
    return result


def cache_surfaces(path, surfaces, rig=None):
    arrays = {}
    for name, surface in surfaces.items():
        arrays[name+'/points'] = np.asarray(surface.points)
        arrays[name+'/triangles'] = np.asarray(surface.triangles, dtype=np.int32)
    if rig is not None:
        arrays['bone_matrices'] = np.asarray([list(b.matrix) for b in rig.pose.bones])
        arrays['rig_matrix_world'] = np.asarray(rig.matrix_world)
    np.savez(path, **arrays)
    return dict(path=path.name, sha256=digest(path))


def compare_surfaces(actual, expected_points, expected_triangles):
    result = {}
    for name, surface in actual.items():
        actual_points = np.asarray(surface.points)
        expected = expected_points[name]
        if actual_points.shape != expected.shape:
            raise ValueError('Changed evaluated vertex count: '+name)
        result[name] = dict(maximum_coordinate_error=float(np.linalg.norm(actual_points-expected, axis=1).max()),
            ordered_triangles_equal=bool(np.array_equal(surface.triangles, expected_triangles[name])))
    return result


def arm_contacts(surfaces):
    internal, contacts = {}, {}
    for name, surface in surfaces.items():
        if not name.startswith(ARM):
            continue
        internal[name] = np.asarray([(a,b) for a,b in surface.tree.overlap(surface.tree)
            if a < b and not set(surface.triangles[a]) & set(surface.triangles[b])], dtype=np.int32).reshape((-1,2))
        for other, target in surfaces.items():
            if other.startswith(PROP) or other == name or (other.startswith(ARM) and other < name):
                continue
            pairs = surface.tree.overlap(target.tree)
            if pairs:
                contacts[name+'/'+other] = (name, other, np.asarray(pairs, dtype=np.int32))
    return internal, contacts


def mapped_segments(first, second, rest_first, rest_second, pairs):
    points, mapped, pair_ids, unresolved = [], [], [], []
    for index, (ai,bi) in enumerate(pairs):
        av,bv = np.asarray(first.triangles[ai]),np.asarray(second.triangles[bi])
        a,b = np.asarray(first.points)[av],np.asarray(second.points)[bv]
        value = attachment.intersection_segment(a,b)
        if value['kind'] != 'segment':
            unresolved.append(dict(pair=index,kind=value['kind']))
            continue
        ends = np.asarray(value['endpoints'])
        weights = [[attachment.barycentric(p,tri) for p in ends] for tri in (a,b)]
        residual = max(float(np.linalg.norm(w@tri-p)) for ws,tri in zip(weights,(a,b)) for w,p in zip(ws,ends))
        if residual > 1e-6 or min(float(np.min(w)) for ws in weights for w in ws) < -1e-5:
            unresolved.append(dict(pair=index,kind='unresolved_barycentric_mapping',residual=residual))
            continue
        points.append(ends)
        mapped.append([np.asarray(weights[0])@np.asarray(rest_first.points)[av],np.asarray(weights[1])@np.asarray(rest_second.points)[bv]])
        pair_ids.append(index)
    return np.asarray(points).reshape((-1,2,3)),np.asarray(mapped).reshape((-1,2,2,3)),np.asarray(pair_ids,dtype=np.int32),unresolved


def run(candidate, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    started = time.time()
    cached = json.loads((candidate/'proof.json').read_text())
    expected = np.load(candidate/'geometry.npz')
    source_provenance = HERE/'book-grip-verify-01/proof.json'
    original_record = json.loads(source_provenance.read_text())
    source_hashes = {sha for path,sha in original_record['inputs'].items() if Path(path).resolve()==SOURCE.resolve()}
    if len(source_hashes)!=1 or digest(SOURCE)!=next(iter(source_hashes)):
        raise ValueError('Required original source differs from the frozen construction provenance')
    inputs = dict(cached['inputs'])
    inputs.update(original_record['inputs'])
    for path in (SOURCE, Path(__file__), candidate/'proof.json', candidate/'geometry.npz', HERE/'book-grip-better-way-review.md', Path(geometry.__file__), Path(rest.__file__)):
        inputs[str(path.resolve())] = digest(path)
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).is_file() and ROOT in Path(path).resolve().parents:
            inputs[str(Path(path).resolve())] = digest(Path(path))
    report = dict(state='running', pid=os.getpid(), background=True, blender_version=bpy.app.version_string,
        opened_original=dict(path=str(SOURCE.resolve()),sha256=digest(SOURCE)), inputs=inputs,
        source_action='read',source_frame=4,source_phase=.75,margin_controls=geometry.margin_controls(),
        scope='Only the frozen book correction; all original body frames and actions retained; no render or animation authoring')
    def save():
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        if not all(digest(Path(p)) == sha for p,sha in inputs.items()):
            raise ValueError('An input changed before source replay')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        if Path(bpy.data.filepath).resolve() != SOURCE.resolve():
            raise ValueError('Opened file is not the required immutable original')
        report['opened_original']['blender_reported_path'] = bpy.data.filepath
        scene=bpy.context.scene;scene.render.threads_mode='FIXED';scene.render.threads=2
        rig=bpy.data.objects['SIM_01_SHARED_RIG'];objects=owned(rig)
        raw=rest.identity(objects,[rig]);actions=action_identity()
        report['raw_source_identity']=raw;report['source_actions']=actions
        report['source_expression_samples']=[]
        rig.animation_data.action=bpy.data.actions['read']
        for frame in (1,2,3,4):
            scene.frame_set(frame);report['source_expression_samples'].append(frame_state(rig,objects))
        source_frame=frame_state(rig,objects);report['source_control_state']=source_frame
        source_book_world=np.asarray(rig.matrix_world@rig.pose.bones['book'].matrix,dtype=np.float64)
        baseline=visible(objects);report['source_control_cache']=cache_surfaces(output/'source-control.npz',baseline,rig)
        guarded=rest.RestAudit(objects,[rig])
        try:
            report['rest_hierarchy']=guarded.activate()
            rest_surfaces=visible(objects)
            report['rest_cache']=cache_surfaces(output/'source-rest.npz',rest_surfaces)
            report['rest_refresh_hierarchy']=guarded.unchanged_refresh()
            refreshed=visible(objects)
            report['rest_refresh']=compare_surfaces(refreshed,{n:np.asarray(s.points) for n,s in rest_surfaces.items()},{n:s.triangles for n,s in rest_surfaces.items()})
            if any(row['maximum_coordinate_error'] > 1e-5 or not row['ordered_triangles_equal'] for row in report['rest_refresh'].values()):
                raise ValueError('Original all-variant rest control did not reproduce')
        finally:
            report['rest_restoration']=guarded.restore();save()
        correction=np.eye(4);correction[:3,:3]=cached['rotation'];correction[:3,3]=cached['translation']
        rig.animation_data.action=None
        rig.pose.bones['book'].matrix=Matrix(source_frame['bone_matrices']['book'])@Matrix(correction.tolist())
        bpy.context.view_layer.update()
        current=visible(objects);report['candidate_state']=frame_state(rig,objects)
        target_points={n:expected[n+'/points']@source_book_world[:3,:3].T+source_book_world[:3,3] for n in current}
        report['cached_candidate_correspondence']=compare_surfaces(current,target_points,{n:expected[n+'/triangles'] for n in current})
        report['candidate_cache']=cache_surfaces(output/'candidate.npz',current,rig)
        if any(row['maximum_coordinate_error'] > 1e-5 for row in report['cached_candidate_correspondence'].values()):
            raise ValueError('Actual original-source candidate differs from frozen cache')
        body=[name for name in current if not name.startswith(PROP)];props=[name for name in current if name.startswith(PROP)]
        if len(props)!=14 or sum(name.startswith('Printed book line') for name in props)!=10:
            raise ValueError('Rendered prop inventory differs from four solids and ten printed lines')
        report['body_source_correspondence']=compare_surfaces({n:current[n] for n in body},{n:np.asarray(baseline[n].points) for n in body},{n:baseline[n].triangles for n in body})
        if any(row['maximum_coordinate_error'] > 1e-6 or not row['ordered_triangles_equal'] for row in report['body_source_correspondence'].values()):
            raise ValueError('The book-only correction changed a source body surface')
        witnesses={};report['prop_solids']={};report['prop_collisions']=[];report['potential_containment']=[]
        for name in props:
            solid=current[name];center,axes,half,description=geometry.box(solid);report['prop_solids'][name]=description
            for part in body:
                surface=current[part];p=np.asarray(surface.points)
                hit=geometry.triangle_box_hits(p[np.asarray(surface.triangles)],center,axes,half)
                if len(hit):
                    key='prop/'+name+'/'+part;witnesses[key]=hit
                    report['prop_collisions'].append(dict(prop=name,body=part,triangles=len(hit),witness_array=key))
                if np.all(np.min(solid.points,axis=0)>=p.min(0)-1e-6) and np.all(np.max(solid.points,axis=0)<=p.max(0)+1e-6):
                    report['potential_containment'].append(dict(prop=name,body=part,classification='Unresolved bounds allow complete containment'))
        report['contacts']={}
        for side,suffix in (('L',''),('R','.001')):
            palm,cover=current['Relaxed palm'+suffix],current['Reading book cover'+suffix]
            points=np.asarray(cover.points);tri=points[np.asarray(cover.triangles)]
            normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);normals/=np.linalg.norm(normals,axis=1)[:,None]
            book_up=np.asarray(rig.matrix_world@rig.pose.bones['book'].matrix)[:3,1]
            up=-normals[np.argmin(normals@book_up)]
            result=continuous.measure(cover.points,cover.triangles,palm.points,palm.triangles,up,.0015)
            report['contacts'][side]={}
            for key,value in result.items():
                if isinstance(value,np.ndarray):witnesses['contact/'+side+'/'+key]=value
                else:report['contacts'][side][key]=value
        source_internal,source_contacts=arm_contacts(baseline);internal,contacts=arm_contacts(current)
        report['arm_internal']={};report['arm_body_contacts']=[]
        for name,pairs in internal.items():
            witnesses['internal/'+name]=pairs
            report['arm_internal'][name]=dict(source=len(source_internal[name]),candidate=len(pairs),source_pairs_equal=bool(np.array_equal(pairs,source_internal[name])))
        for key,(first,second,pairs) in contacts.items():
            equal=key in source_contacts and np.array_equal(pairs,source_contacts[key][2])
            witnesses['attachment/'+key+'/pairs']=pairs
            endpoints,mapped,ids,unresolved=mapped_segments(current[first],current[second],rest_surfaces[first],rest_surfaces[second],pairs)
            witnesses['attachment/'+key+'/world_segments']=endpoints;witnesses['attachment/'+key+'/rest_segments']=mapped;witnesses['attachment/'+key+'/mapped_pair_ids']=ids
            rest_pairs=np.asarray(rest_surfaces[first].tree.overlap(rest_surfaces[second].tree),dtype=np.int32).reshape((-1,2))
            witnesses['attachment/'+key+'/rest_pairs']=rest_pairs
            re,rm,ri,ru=mapped_segments(rest_surfaces[first],rest_surfaces[second],rest_surfaces[first],rest_surfaces[second],rest_pairs)
            witnesses['attachment/'+key+'/rest_region_segments']=re
            envelope=[re.reshape((-1,3)).min(0),re.reshape((-1,3)).max(0)] if len(re) else None
            if envelope is not None and len(mapped):
                outside=np.any((mapped < envelope[0]-1e-6)|(mapped > envelope[1]+1e-6),axis=(1,2,3))
                witnesses['attachment/'+key+'/outside_rest_region_pair_ids']=ids[outside]
            else:outside=np.ones(len(mapped),dtype=bool)
            report['arm_body_contacts'].append(dict(parts=[first,second],pairs=len(pairs),source_pose_pairs_equal=bool(equal),
                mapped_segments=len(mapped),unresolved=unresolved,source_rest_crossings=len(rest_pairs),source_rest_unresolved=ru,
                source_rest_overlap_bounds=[e.tolist() for e in envelope] if envelope is not None else None,
                within_source_rest_overlap_segments=int((~outside).sum()),outside_source_rest_overlap_segments=int(outside.sum()),
                classification='Unchanged source-pose contact; material-space region witnesses retained for attachment review, not a whole-pair exemption'))
        np.savez(output/'witnesses.npz',**witnesses);report['witness_sha256']=digest(output/'witnesses.npz')
        if report['prop_collisions'] or report['potential_containment'] or any(row['candidate'] for row in report['arm_internal'].values()):
            raise ValueError('Actual evaluated clearance or arm interior checks failed')
        if any(not row['source_pose_pairs_equal'] for row in report['arm_body_contacts']):
            raise ValueError('Book-only replay introduced an arm/body contact')
        if any(row['projected_area']<=1e-10 or min(row['spans'])<=1e-6 for row in report['contacts'].values()):
            raise ValueError('A finite palm support patch was lost')
        report['raw_identity_unchanged']=rest.identity(objects,[rig])==raw
        report['actions_unchanged']=action_identity()==actions
        if not report['raw_identity_unchanged'] or not report['actions_unchanged']:
            raise ValueError('Source identity or saved action data changed')
        derivative=output/'frozen-pitched-edge.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(derivative))
        report['derivative']=dict(path=derivative.name,sha256=digest(derivative));save()
        bpy.ops.wm.open_mainfile(filepath=str(derivative))
        rig=bpy.data.objects['SIM_01_SHARED_RIG'];objects=owned(rig);reopened=visible(objects)
        report['reopened_state']=frame_state(rig,objects)
        report['reopened_correspondence']=compare_surfaces(reopened,{n:np.asarray(s.points) for n,s in current.items()},{n:s.triangles for n,s in current.items()})
        report['reopened_cache']=cache_surfaces(output/'reopened.npz',reopened,rig)
        if any(row['maximum_coordinate_error']>1e-5 or not row['ordered_triangles_equal'] for row in report['reopened_correspondence'].values()):
            raise ValueError('Saved derivative did not replay its evaluated geometry')
        report['reopened_raw_identity_unchanged']=rest.identity(objects,[rig])==raw
        report['reopened_actions_unchanged']=action_identity()==actions
        if not report['reopened_raw_identity_unchanged'] or not report['reopened_actions_unchanged']:
            raise ValueError('Derivative changed original rest identity or action data')
        report['input_hashes_unchanged']=all(digest(Path(p))==sha for p,sha in inputs.items())
        if not report['input_hashes_unchanged']:raise ValueError('Replay inputs changed')
        report.update(state='complete',replay_passed=True,acceptance='Static source replay and rendered-prop clearance passed; source attachments, visible support/gaze and mechanical equilibrium are not accepted by this receipt')
    except BaseException as error:
        report.update(state='failed',error=repr(error));raise
    finally:
        report['elapsed_seconds']=time.time()-started;save()


if __name__=='__main__':
    run(*(Path(p) for p in sys.argv[sys.argv.index('--')+1:]))
