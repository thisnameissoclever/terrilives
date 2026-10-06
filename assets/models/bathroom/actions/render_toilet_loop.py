"""Bake/check a closed approved toilet loop and render its complete raw source matrix."""
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE=Path(__file__).resolve().parent
MODELS=BASE.parents[1]
sys.path[:0]=[str(BASE),str(MODELS/'furniture'),str(MODELS/'sims/sim-01')]
from toilet_loop_v1 import (ACTION_NAME,FACINGS,VARIANTS,STATIC_BONES,apply_phase,bake,capture_baseline)
from toilet_contact import measure
from toilet_leg_probe import curved_support,capture
from render_toilet_use_v2 import require_candidate,canvas_margin,validate_fixture
from animation_export import render_pass
from render_shirt_variants import material_snapshot,set_shirt_colors,SHIRT_COLORS,topology_sha256
from render_toilet_ink import render_body_ink
from armchair_contact import body_inventory

ACCEPTED=BASE/'review/toilet/prototype-08-curved-support'
SOURCE_PROOF=ACCEPTED/'proof.json'
SOURCE_MODEL=ACCEPTED/'toilet-pose-authoring.blend'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')


def geometry(collection):
    deps=bpy.context.evaluated_depsgraph_get()
    result={}
    for obj in collection.all_objects:
        if obj.hide_render:
            continue
        if obj.type not in ('MESH','CURVE'):
            raise ValueError('Unhandled visible source geometry owner')
        evaluated=obj.evaluated_get(deps)
        mesh=evaluated.to_mesh()
        try:
            points=[tuple(evaluated.matrix_world@v.co) for v in mesh.vertices]
            polygons=[tuple(p.vertices) for p in mesh.polygons]
            result[obj.name]=hashlib.sha256(repr((points,polygons)).encode()).hexdigest()
        finally:
            evaluated.to_mesh_clear()
    return result


def targets(rig):
    return {b.name:dict(head=list(b.head),tail=list(b.tail)) for b in rig.pose.bones}


def restore_green(materials):
    for name in SHIRT_COLORS['blue']:
        node=next(n for n in bpy.data.materials[name].node_tree.nodes if n.type=='VALTORGB')
        for stop,source in zip(node.color_ramp.elements,materials[name][node.name+'/ramp']):
            stop.color=source['color']


def palette(name,materials):
    if name=='green':
        restore_green(materials)
    else:
        set_shirt_colors(SHIRT_COLORS[name],materials)
    after=material_snapshot()
    changes=[]
    for material,values in materials.items():
        for field,old in values.items():
            new=after[material][field]
            if new!=old:
                if material not in SHIRT_COLORS['blue'] or not field.endswith('/ramp'):
                    raise ValueError('Palette changed non-shirt or non-ramp source material state')
                if [s['position'] for s in old]!=[s['position'] for s in new] or [s['color'][3] for s in old]!=[s['color'][3] for s in new]:
                    raise ValueError('Palette changed shade positions or opacity')
                changes.append(dict(material=material,field=field,before=old,after=new))
    if (name=='green' and changes) or (name!='green' and len(changes)!=3):
        raise ValueError('Palette did not use the exact three existing shirt ramps')
    return changes


def registration(scene,reference):
    if scene.camera.data.type!='ORTHO' or [scene.render.resolution_x,scene.render.resolution_y]!=[768,960]:
        raise ValueError('Accepted source camera/canvas changed')
    origin=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
    values=dict(original_render_dimensions=[768,960],origin_pixels=[origin.x*768,(1-origin.y)*960],
        camera_matrix=[list(row) for row in scene.camera.matrix_world],ortho_scale=scene.camera.data.ortho_scale)
    if values['camera_matrix']!=reference['camera_matrix'] or values['ortho_scale']!=reference['ortho_scale'] or any(
            abs(a-b)>1e-5 for a,b in zip(values['origin_pixels'],reference['origin_pixels'])):
        raise ValueError('Accepted camera or world-origin registration drifted')
    return values


def raster_record(path):
    data=path.read_bytes()
    if data[:8]!=b'\x89PNG\r\n\x1a\n':
        raise ValueError('Source output is not PNG')
    width,height=struct.unpack('>II',data[16:24])
    if (width,height)!=(768,960) or data[24]!=8 or data[25]!=6:
        raise ValueError('Original source PNG size/8-bit RGBA mode changed')
    image=bpy.data.images.load(str(path),check_existing=False)
    try:
        if tuple(image.size)!=(width,height) or image.channels!=4:
            raise ValueError('Decoded source image has wrong dimensions/channels')
        indices={4*(y*width+x)+3 for y in (0,height-1) for x in range(width)}
        indices|={4*(y*width+x)+3 for x in (0,width-1) for y in range(height)}
        alpha=max(image.pixels[i] for i in indices)
        if alpha!=0:
            raise ValueError('Original source output touches its transparent border')
    finally:
        bpy.data.images.remove(image)
    return dict(width=width,height=height,mode='RGBA',bit_depth=8,border_alpha_max=alpha)


def physical(root,rig,body,requested):
    if {o.name for o in body.all_objects if not o.hide_render}!=body_inventory():
        raise ValueError('Loop hid an approved body surface')
    metrics=measure(root,rig,body,require=False)
    support=curved_support(capture(bpy.data.objects['Trouser hip bridge']),capture(bpy.data.objects['Toilet open seat ring']),requested)
    require_candidate(metrics,support,root,rig)
    return dict(physical_metrics=metrics,curved_support=support,
        rectangle_only_support_state=metrics['independent_ring_support']['state'],
        acceptance_support='actual continuous mirrored crescent cells; rectangle-only rejection is not overridden as a pass')


def configure_source(scene):
    scene.render.resolution_percentage=100
    scene.render.threads_mode='FIXED'
    scene.render.threads=2
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.render.image_settings.color_depth='8'
    bpy.context.preferences.filepaths.save_version=0


def run(output,ink_output):
    if not bpy.app.background or not output.is_absolute() or not ink_output.is_absolute():
        raise ValueError('Use hidden background Blender and two new absolute owned directories')
    output.mkdir(parents=True,exist_ok=False)
    ink_output.mkdir(parents=True,exist_ok=False)
    reference=json.loads(SOURCE_PROOF.read_text())
    if reference['state']!='complete' or digest(SOURCE_MODEL)!=reference['editable_model']['sha256']:
        raise ValueError('Accepted source receipt/model is incomplete or changed')
    inputs=dict(reference['inputs'])
    paths={Path(module.__file__).resolve() for module in sys.modules.values()
        if getattr(module,'__file__',None) and str(module.__file__).endswith('.py')
        and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    paths.update((SOURCE_PROOF,SOURCE_MODEL,BASE/'toilet_loop_v1.py',BASE/'render_toilet_ink.py',BASE/'test_toilet_loop.py'))
    for name,expected in inputs.items():
        if digest(MODELS/name)!=expected:
            raise ValueError('Accepted pinned producer/input changed: '+name)
    inputs.update({p.relative_to(MODELS).as_posix():digest(p) for p in paths})
    for name in inputs:
        path=MODELS/name
        if path.suffix=='.py':
            snapshot=output/'source'/name
            snapshot.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,snapshot)
    proof=dict(schema=1,state='running',inputs=inputs,blender_version=bpy.app.version_string,
        blender_build_hash=bpy.app.build_hash.decode(),
        action=dict(name=ACTION_NAME,samples=4,closure_frame=4,half_cycle_ticks=8,loop_ticks=16,sample_fps=2.5),
        accepted_source=dict(proof_path=SOURCE_PROOF.relative_to(MODELS).as_posix(),proof_sha256=digest(SOURCE_PROOF),
            model_path=SOURCE_MODEL.relative_to(MODELS).as_posix(),model_sha256=digest(SOURCE_MODEL)),
        logical_canvas=[96,120],source_density=8,contacts=[],reopened_contacts=[],manual_contacts=[],
        renders=[],raster_checks=[],geometry_palette_checks=[],source_export_acceptance=False,
        body_ink=dict(directory='../'+ink_output.name,proof='proof.json',expected_frames=16))
    ink=dict(schema=1,state='running',inputs=inputs,renders=[],raster_checks=[],stroke_ownership=[],
             producer_sha256=digest(BASE/'render_toilet_ink.py'))
    journal=output/'proof.json'
    ink_journal=ink_output/'proof.json'
    def save():
        save_json(journal,proof)
        save_json(ink_journal,ink)
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE_MODEL))
        scene=bpy.context.scene
        rig,root=bpy.data.objects['SIM_01_SHARED_RIG'],bpy.data.objects['TOILET_MODEL_ROOT']
        rig.animation_data.action=None
        root.rotation_euler.z=rig.rotation_euler.z=0
        scene.frame_set(1)
        body,fixture=bpy.data.collections['Toilet action body'],bpy.data.collections['Toilet action fixture']
        configure_source(scene)
        proof.update(registration(scene,reference))
        proof['fixture_validation']=validate_fixture()
        baseline=capture_baseline(rig)
        accepted_geometry=geometry(body)
        static_fixture=geometry(fixture)
        original_targets=targets(rig)
        requested={tuple(row['cell']) for row in reference['curved_support']['continuous_cells']}
        for frame in range(5):
            motion=apply_phase(rig,baseline,frame/4)
            contact=physical(root,rig,body,requested)
            current=geometry(body)
            proof['manual_contacts'].append(dict(frame=frame,phase=frame/4,motion=motion,**contact))
            if frame in (0,4) and (current!=accepted_geometry or targets(rig)!=original_targets):
                raise ValueError('Exact phase0/endpoint baseline geometry or targets changed')
            if geometry(fixture)!=static_fixture:
                raise ValueError('Loop moved immutable fixture geometry')
            save()
        proof['closure']=dict(manual_exact_phase0=True,manual_exact_endpoint=True,
            complete_body_inventory=sorted(accepted_geometry),all54_evaluated=True,foot_movement=False)
        action=bake(rig,baseline)
        scene.frame_set(1)
        bpy.context.view_layer.update()
        if geometry(body)!=accepted_geometry or targets(rig)!=original_targets:
            raise ValueError('Baked first sample is not the exact accepted baseline')
        model=output/'toilet-loop-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model']=dict(path=model.name,sha256=digest(model))
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene=bpy.context.scene
        rig,root=bpy.data.objects['SIM_01_SHARED_RIG'],bpy.data.objects['TOILET_MODEL_ROOT']
        body,fixture=bpy.data.collections['Toilet action body'],bpy.data.collections['Toilet action fixture']
        if rig.animation_data.action.name!=ACTION_NAME:
            raise ValueError('Saved loop action is missing or changed')
        proof['saved_fixture_validation']=validate_fixture()
        proof.update(registration(scene,reference))
        materials=material_snapshot()
        topology=topology_sha256()
        proof['palettes']={}
        for variant in VARIANTS:
            proof['palettes'][variant]=dict(material_changes=palette(variant,materials),
                setter='immutable render_shirt_variants.set_shirt_colors',geometry_consistent=True)
            for frame in range(5):
                scene.frame_set(frame+1)
                bpy.context.view_layer.update()
                contact=physical(root,rig,body,requested)
                proof['contacts'].append(dict(variant=variant,frame=frame,phase=frame/4,**contact))
                if variant=='green':
                    proof['reopened_contacts'].append(dict(frame=frame,phase=frame/4,**contact))
                if frame in (0,4) and (geometry(body)!=accepted_geometry or targets(rig)!=original_targets):
                    raise ValueError('Saved palette closure changed accepted complete-body geometry/targets')
                save()
        proof['closure'].update(saved_exact_phase0=True,saved_exact_endpoint=True,named_bones=original_targets)
        restore_green(materials)
        if material_snapshot()!=materials or topology_sha256()!=topology:
            raise ValueError('Palette verification changed green source materials/topology')
        for facing,degrees in FACINGS.items():
            root.rotation_euler.z=rig.rotation_euler.z=math.radians(degrees)
            for frame in range(4):
                scene.frame_set(frame+1)
                bpy.context.view_layer.update()
                baseline_frame=None
                for variant in VARIANTS:
                    palette(variant,materials)
                    state=dict(body=geometry(body),fixture=geometry(fixture),
                               visible_body=sorted(o.name for o in body.all_objects if not o.hide_render),
                               topology=topology_sha256())
                    if baseline_frame is None:
                        baseline_frame=state
                    elif state!=baseline_frame:
                        raise ValueError('Palette changed geometry or reciprocal owner inventory')
                    margin=canvas_margin(scene,(body,fixture))
                    proof['geometry_palette_checks'].append(dict(facing=facing,variant=variant,frame=frame,
                        minimum_canvas_margin=margin,geometry=state,complete_owner_consistency=True))
                    for owner in ('beauty','sim','furniture','lines'):
                        path=output/f'{facing}-{variant}-{frame}-{owner}.png'
                        render_pass(scene,body,fixture,owner,path,separate_lines=True)
                        proof['renders'].append(dict(facing=facing,variant=variant,frame=frame,owner=owner,
                                                     path=path.name,sha256=digest(path)))
                        proof['raster_checks'].append(dict(path=path.name,**raster_record(path)))
                        save()
                restore_green(materials)
                path=ink_output/f'{facing}-green-{frame}-body_ink.png'
                ink['stroke_ownership'].append(dict(facing=facing,frame=frame,**render_body_ink(scene,body,fixture,path)))
                ink['renders'].append(dict(facing=facing,variant='green',frame=frame,owner='body_ink',
                                           path=path.name,sha256=digest(path)))
                ink['raster_checks'].append(dict(path=path.name,**raster_record(path)))
                save()
        if len(proof['renders'])!=192 or len(ink['renders'])!=16 or len(proof['contacts'])!=15:
            raise ValueError('Complete loop/palette/facing/owner/closure source matrix is missing')
        proof['immutable_inputs_preserved']=all(digest(MODELS/name)==sha for name,sha in inputs.items())
        if not proof['immutable_inputs_preserved'] or digest(model)!=proof['editable_model']['sha256']:
            raise ValueError('Loop generation changed a pinned input or saved model')
        proof['state']='complete'
        save_json(journal,proof)
        ink.update(state='complete',source_proof_sha256=digest(journal),source_model_sha256=digest(model),
                   original_render_dimensions=proof['original_render_dimensions'],origin_pixels=proof['origin_pixels'],
                   camera_matrix=proof['camera_matrix'],ortho_scale=proof['ortho_scale'],immutable_inputs_preserved=True)
        save_json(ink_journal,ink)
    except BaseException:
        proof.update(state='failed',error=traceback.format_exc())
        ink.update(state='failed',error=proof['error'])
        save()
        raise


def render_ink_replay(source_proof,output):
    if not bpy.app.background or not source_proof.is_absolute() or not output.is_absolute():
        raise ValueError('Ink replay needs background Blender and absolute source/output paths')
    source=json.loads(source_proof.read_text())
    if source['state']!='complete' or len(source['renders'])!=192:
        raise ValueError('Ink replay requires complete loop source colour/line matrix')
    for name,sha in source['inputs'].items():
        if digest(MODELS/name)!=sha:
            raise ValueError('Ink replay source dependency changed: '+name)
    model=source_proof.parent/source['editable_model']['path']
    if digest(model)!=source['editable_model']['sha256']:
        raise ValueError('Ink replay source model changed')
    output.mkdir(parents=True,exist_ok=False)
    receipt=dict(schema=1,state='running',source_proof_sha256=digest(source_proof),
        source_model_sha256=digest(model),inputs=dict(source['inputs']),renders=[],raster_checks=[],stroke_ownership=[],
        producer_sha256=digest(BASE/'render_toilet_ink.py'),
        **{field:source[field] for field in ('original_render_dimensions','origin_pixels','camera_matrix','ortho_scale')})
    journal=output/'proof.json'
    save_json(journal,receipt)
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene=bpy.context.scene
        rig,root=bpy.data.objects['SIM_01_SHARED_RIG'],bpy.data.objects['TOILET_MODEL_ROOT']
        body,fixture=bpy.data.collections['Toilet action body'],bpy.data.collections['Toilet action fixture']
        configure_source(scene)
        registration(scene,source)
        if rig.animation_data.action.name!=ACTION_NAME:
            raise ValueError('Ink replay action changed')
        for facing,degrees in FACINGS.items():
            root.rotation_euler.z=rig.rotation_euler.z=math.radians(degrees)
            for frame in range(4):
                scene.frame_set(frame+1)
                bpy.context.view_layer.update()
                path=output/f'{facing}-green-{frame}-body_ink.png'
                receipt['stroke_ownership'].append(dict(facing=facing,frame=frame,**render_body_ink(scene,body,fixture,path)))
                receipt['renders'].append(dict(facing=facing,variant='green',frame=frame,owner='body_ink',path=path.name,sha256=digest(path)))
                receipt['raster_checks'].append(dict(path=path.name,**raster_record(path)))
                save_json(journal,receipt)
        if digest(source_proof)!=receipt['source_proof_sha256'] or digest(model)!=receipt['source_model_sha256']:
            raise ValueError('Ink replay mutated its complete source proof/model')
        receipt.update(state='complete',immutable_inputs_preserved=True)
        save_json(journal,receipt)
    except BaseException:
        receipt.update(state='failed',error=traceback.format_exc())
        save_json(journal,receipt)
        raise


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]),Path(args[1]))
