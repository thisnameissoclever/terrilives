"""Verify saved skeleton, weights, local loops, skin motion and held-book contact."""
import bpy
import hashlib
import json
import traceback
from pathlib import Path
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent


def mesh_points(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return result


def validate():
    assert bpy.app.background
    (BASE/'saved-rig-validation.json').write_text(json.dumps({'state':'running'}))
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    assert len([obj for obj in bpy.data.objects if obj.type=='ARMATURE']) == 1
    assert len(rig.data.bones) == 17
    parts = [obj for obj in bpy.data.objects if obj.type=='MESH' and obj.parent==rig]
    weight_count = 0
    for obj in parts:
        modifiers = [m for m in obj.modifiers if m.type=='ARMATURE' and m.object==rig]
        assert len(modifiers)==1, obj.name
        assert obj.modifiers[0]==modifiers[0], obj.name
        for vertex in obj.data.vertices:
            assert vertex.groups, (obj.name,vertex.index)
            assert all(g.weight >= 0 for g in vertex.groups)
            assert abs(sum(g.weight for g in vertex.groups)-1) < 1e-6
            weight_count += 1
    proof = {'state':'complete','weighted_vertices':weight_count,'bound_meshes':len(parts),'bones':17,'clips':{}}
    source_hash=hashlib.sha256((BASE/'source/approved-neutral.blend').read_bytes()).hexdigest()
    assert source_hash==rig['source_sha256']
    proof['source_sha256']=source_hash
    original=json.loads((BASE/'scene-inspection.json').read_text())
    retained_materials={}
    for entry in original['objects']:
        if entry['type'] not in ('MESH','CURVE') or entry['hidden']:
            continue
        obj=bpy.data.objects[entry['name']]
        materials=[m.name for m in obj.data.materials]
        assert materials==entry['materials'], (entry['name'],materials,entry['materials'])
        retained_materials[entry['name']]=materials
    proof['retained_material_slots']=retained_materials
    rig.animation_data.action = bpy.data.actions['idle']
    scene.frame_set(1)
    neutral_ground = [min(v.z for v in mesh_points(bpy.data.objects[name])) for name in ('Fitted rounded shoe sole','Fitted rounded shoe sole.001')]
    for action in ('idle','walk','read','talk','eat','stand_read','watch_fish','sit','sleep'):
        rig.animation_data.action = bpy.data.actions[action]
        count = int(rig.animation_data.action['loop_samples'])
        samples = []
        for index in range(count+1):
            scene.frame_set(index+1)
            samples.append({name:mesh_points(bpy.data.objects[name]) for name in (
                'Tailored trouser leg','Tailored trouser leg.001',
                'Forearm with elbow and wrist sections','Forearm with elbow and wrist sections.001')})
        maximum_motion = max((first-later).length for name,values in samples[0].items() for sample in samples[1:] for first,later in zip(values,sample[name]))
        closure_error = max((first-last).length for name,values in samples[0].items() for first,last in zip(values,samples[-1][name]))
        assert closure_error < 1e-5, (action,closure_error)
        if action=='walk':
            assert maximum_motion > .15, maximum_motion
        proof['clips'][action] = {'sample_count':count,'mesh_displacement':maximum_motion,'loop_closure_error':closure_error}
    rig.animation_data.action = bpy.data.actions['walk']
    stance_errors=[]
    for index in range(8):
        scene.frame_set(index+1)
        for side,name in enumerate(('Fitted rounded shoe sole','Fitted rounded shoe sole.001')):
            phase=(index/8+side*.5)%1
            if phase<.5:
                error=abs(min(v.z for v in mesh_points(bpy.data.objects[name]))-neutral_ground[side])
                stance_errors.append(error)
                assert error<1e-5,(index,side,error)
    proof['walk_stance_sole_errors']=stance_errors
    rig.animation_data.action = bpy.data.actions['read']
    book = [obj for obj in parts if 'book' in obj.name.lower()]
    contact = []
    for index in range(4):
        scene.frame_set(index+1)
        vertices,polygons = [],[]
        for obj in book:
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            offset = len(vertices)
            vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
            polygons.extend(tuple(v+offset for v in poly.vertices) for poly in mesh.polygons)
            evaluated.to_mesh_clear()
        surface = BVHTree.FromPolygons(vertices,polygons)
        contacts = {}
        for name in ('Relaxed palm','Relaxed palm.001'):
            distances = [surface.find_nearest(point)[3] for point in mesh_points(bpy.data.objects[name])]
            nearest = min(distance for distance in distances if distance is not None)
            contacts[name] = nearest
            assert nearest < .03, (index,name,nearest)
        contact.append(contacts)
    proof['reading_hand_book_surface_distances'] = contact
    scene.frame_set(1)
    butt = mesh_points(bpy.data.objects['Trouser hip bridge'])
    butt_bounds = [[min(v[i] for v in butt) for i in range(3)],[max(v[i] for v in butt) for i in range(3)]]
    proof['reading_butt_surface_bounds'] = butt_bounds
    torso=mesh_points(bpy.data.objects['Overshirt body'])
    proof['seated_torso_rear_y']=max(v.y for v in torso)
    assert proof['seated_torso_rear_y']<.12,proof['seated_torso_rear_y']
    proof['chair_cushion_reference'] = {'x':[-.24,.32],'y':[-.30,.30],'top_z':.42}
    assert .39 < butt_bounds[0][2] < .43, butt_bounds
    ground = []
    for name in ('Fitted rounded shoe sole','Fitted rounded shoe sole.001'):
        ground.append(min(v.z for v in mesh_points(bpy.data.objects[name])))
    proof['reading_sole_min_z'] = ground
    proof['neutral_sole_min_z'] = neutral_ground
    assert all(abs(value-neutral) < 1e-5 for value,neutral in zip(ground,neutral_ground)), (ground,neutral_ground)
    rig.animation_data.action=bpy.data.actions['sleep']
    scene.frame_set(1)
    planted={name:mesh_points(bpy.data.objects[name]) for name in ('Sculpted head','Trouser hip bridge','Fitted rounded shoe sole','Fitted rounded shoe sole.001')}
    for index in range(4):
        scene.frame_set(index+1)
        for name,reference in planted.items():
            error=max((a-b).length for a,b in zip(reference,mesh_points(bpy.data.objects[name])))
            assert error<1e-5,(name,index,error)
        assert bpy.data.objects['Eye white'].hide_render
        assert not bpy.data.objects['Sleep closed eyelid'].hide_render
    rig.animation_data.action=bpy.data.actions['idle']
    scene.frame_set(1)
    assert not bpy.data.objects['Eye white'].hide_render
    assert bpy.data.objects['Sleep closed eyelid'].hide_render
    proof['sleep_expression_and_planted_body']='PASS'
    proof['blend_sha256'] = hashlib.sha256((BASE/'sim-01-rigged.blend').read_bytes()).hexdigest()
    (BASE/'saved-rig-validation.json').write_text(json.dumps(proof,indent=2)+'\n')


if __name__=='__main__':
    try:
        validate()
    except Exception:
        (BASE/'saved-rig-validation.json').write_text(json.dumps({'state':'failed','traceback':traceback.format_exc()},indent=2))
        raise
