"""Build the accepted Sim's editable skeleton and authored local action pilot.

Run with Blender background mode. No network, add-ons, or external assets are used.
"""
import bpy
import hashlib
import json
import math
import sys
import time
import traceback
import numpy as np
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from rig_math import blend, knee_point, walk_ankle, walk_hip
from food_depth import gripping_depth
from render_job import apply_render_job

REVIEW = BASE / 'review'
EXPORT = BASE / 'export'
STATUS = BASE / 'build-status.json'
EXPECTED_SOURCE = 'a90fd5be6c2c60b89216d4881b9f4265a45fb662d913299daa12cc3b247d9ece'
CLIPS = {'idle': (1, 1), 'walk': (8, 10), 'read': (4, 2),
         'talk':(4,2),'eat':(4,2),'stand_read':(4,2),'watch_fish':(4,2),'sit':(4,2)}
CLIPS['sleep']=(4,1)
FACINGS = {'SE': 90, 'SW': 0, 'NW': 270, 'NE': 180}
CANVASES = {'idle':(38,88),'walk':(52,104),'read':(52,104)}
CANVASES.update({name:(52,104) for name in CLIPS if name not in CANVASES})
CANVASES['sleep']=(104,76)
EYE_PREFIXES=('Eye white','Dark pupil','Hazel iris','Small eye catchlight','Upper lid outline')


def status(state, **data):
    STATUS.write_text(json.dumps({'state': state, 'updated_at': time.time(), **data}, indent=2))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bind(obj, rig, weights):
    groups = {}
    for vertex in obj.data.vertices:
        values = weights(vertex.co)
        assert all(value >= 0 for value in values.values())
        assert abs(sum(values.values()) - 1) < 1e-7
        for name, value in values.items():
            if value <= 0:
                continue
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([vertex.index], value, 'REPLACE')
    modifier = obj.modifiers.new('SIM shared skeleton deformation', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = False
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)


def make_rig(parts):
    armature = bpy.data.armatures.new('SIM_01_HUMANOID')
    rig = bpy.data.objects.new('SIM_01_SHARED_RIG', armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(name, head, tail, parent=None):
        item = armature.edit_bones.new(name)
        item.head, item.tail = head, tail
        if parent:
            item.parent = armature.edit_bones[parent]
        return item
    bone('root', (0, 0, 0), (0, 0, .1))
    bone('hips', (0, 0, .86), (0, 0, 1.03), 'root')
    bone('spine', (0, 0, 1.03), (0, 0, 1.39), 'hips')
    bone('head', (0, 0, 1.40), (0, 0, 1.91), 'spine')
    for side, sign in (('L', -1), ('R', 1)):
        bone('upper_arm.' + side, (sign*.23, 0, 1.30), (sign*.29, -.007, 1.022), 'spine')
        bone('forearm.' + side, (sign*.29, -.007, 1.022), (sign*.32, -.02, .81), 'upper_arm.' + side)
        bone('hand.' + side, (sign*.32, -.02, .81), (sign*.32, -.035, .70), 'forearm.' + side)
        bone('thigh.' + side, (sign*.124, 0, .86), (sign*.124, 0, .49), 'hips')
        bone('shin.' + side, (sign*.124, 0, .49), (sign*.124, 0, .13), 'thigh.' + side)
        bone('foot.' + side, (sign*.124, 0, .13), (sign*.124, -.14, .13), 'shin.' + side)
    bone('book', (0, -.40, .89), (0, -.40, .99), 'root')
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in parts:
        name = obj.name.lower()
        midpoint = sum((v.co.x for v in obj.data.vertices)) / len(obj.data.vertices)
        side = 'L' if midpoint < 0 else 'R'
        if any(token in name for token in ('shoe', 'sole')):
            weights = lambda v, side=side: {'foot.'+side: 1}
        elif 'trouser leg' in name:
            def weights(v, side=side):
                lower = 1-blend(v.z, .43, .56)
                hip = blend(v.z, .78, .90) * .7
                return {'shin.'+side: lower, 'thigh.'+side: (1-lower)*(1-hip), 'hips': (1-lower)*hip}
        elif 'trouser hem' in name:
            weights = lambda v, side=side: {'shin.'+side: 1}
        elif 'hip bridge' in name:
            weights = lambda v: {'hips': 1}
        elif any(token in name for token in ('palm', 'thumb')):
            weights = lambda v, side=side: {'hand.'+side: 1}
        elif 'forearm' in name:
            def weights(v, side=side):
                upper = blend(v.z, 1.005, 1.025)
                hand = 1-blend(v.z, .795, .835)
                return {'upper_arm.'+side: upper, 'forearm.'+side: (1-upper)*(1-hand), 'hand.'+side:(1-upper)*hand}
        elif 'sleeve' in name:
            def weights(v, side=side):
                torso = blend(v.z, 1.26, 1.37) * .88
                return {'upper_arm.'+side: 1-torso, 'spine': torso}
        elif 'neck' in name:
            def weights(v):
                head = blend(v.z, 1.35, 1.445)
                return {'head': head, 'spine': 1-head}
        elif min(v.co.z for v in obj.data.vertices) > 1.41 or 'hair_' in name:
            weights = lambda v: {'head': 1}
        else:
            weights = lambda v: {'spine': 1}
        bind(obj, rig, weights)
    return rig


def material(name, color):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .85
    return result


def make_book(rig):
    pages = material('SIM_PROP warm paper', (.82, .75, .58))
    cover = material('SIM_PROP oxblood book cover', (.27, .055, .035))
    ink = material('SIM_PROP printed lines', (.17, .15, .11))
    result = []
    def cube(name, center, scale, mat, angle=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        obj = bpy.context.object
        obj.name = name
        obj.scale = scale
        obj.rotation_euler.y = angle
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.data.materials.append(mat)
        bind(obj, rig, lambda v: {'book': 1})
        result.append(obj)
    for sign in (-1, 1):
        cube('Reading book cover', (sign*.087, -.405, .885), (.178,.225,.016), cover, sign*-.12)
        cube('Reading book pages', (sign*.084, -.405, .899), (.16,.207,.017), pages, sign*-.12)
        for line in range(5):
            cube('Printed book line', (sign*.084, -.47+line*.028, .919), (.115,.005,.0015), ink)
    return result


def make_sleep_lids(rig):
    result=[]
    for sign in (-1,1):
        curve=bpy.data.curves.new('Sleeping closed eyelid','CURVE')
        curve.dimensions='3D'
        curve.bevel_depth=.004
        curve.bevel_resolution=3
        spline=curve.splines.new('BEZIER')
        spline.bezier_points.add(4)
        for index,point in enumerate(spline.bezier_points):
            t=index/4
            point.co=(sign*.090+(.072*t-.036),-.178-.010*math.sin(math.pi*t),1.692-.012*math.sin(math.pi*t))
            point.handle_left_type='AUTO'
            point.handle_right_type='AUTO'
        obj=bpy.data.objects.new('Sleep closed eyelid',curve)
        bpy.context.collection.objects.link(obj)
        curve.materials.append(bpy.data.materials['Warm dark facial marks'])
        bpy.context.view_layer.update()
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        name=obj.name
        bpy.data.objects.remove(obj,do_unlink=True)
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        bind(obj,rig,lambda v:{'head':1})
        obj.hide_render=True
        result.append(obj)
    return result


def configure_visibility(rig,parts,book,sleep_lids):
    rig['eyes_closed']=0.0
    rig['book_visible']=0.0
    def visibility(obj,property_name,invert):
        for path in ('hide_render','hide_viewport'):
            driver=obj.driver_add(path).driver
            variable=driver.variables.new()
            variable.name='flag'
            variable.type='SINGLE_PROP'
            variable.targets[0].id=rig
            variable.targets[0].data_path=f'["{property_name}"]'
            driver.expression='1-flag' if invert else 'flag'
    for obj in parts:
        if obj.name.startswith(EYE_PREFIXES):
            visibility(obj,'eyes_closed',False)
    for obj in sleep_lids:
        visibility(obj,'eyes_closed',True)
    for obj in book:
        visibility(obj,'book_visible',True)


def direct_bone(rig, name, head, tail):
    rest = rig.data.bones[name]
    head, tail = Vector(head), Vector(tail)
    rotation = (rest.tail_local-rest.head_local).rotation_difference(tail-head)
    rig.pose.bones[name].matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4() @ rest.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()


def arm_elbow(shoulder, wrist, upper, lower, pole):
    delta = wrist-shoulder
    distance = delta.length
    assert abs(upper-lower) < distance < upper+lower, (distance, upper+lower)
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    axis = delta.normalized()
    perpendicular = pole-shoulder
    perpendicular -= axis*perpendicular.dot(axis)
    return shoulder+axis*along+perpendicular.normalized()*math.sqrt(max(0, upper*upper-along*along))


def pose(rig, action, phase):
    rig['eyes_closed']=float(action=='sleep')
    rig['book_visible']=float(action in ('read','stand_read'))
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    if action == 'idle':
        return
    if action=='sleep':
        # Keep torso and head planted; only the exposed hands breathe gently.
        for side,sign in (('L',-1),('R',1)):
            hip=Vector((sign*.124,0,.86))
            ankle=Vector((sign*.124,.045,.575))
            ky,kz=knee_point((hip.y,hip.z),(ankle.y,ankle.z),.37,.36)
            knee=Vector((sign*.124,ky,kz))
            direct_bone(rig,'thigh.'+side,hip,knee)
            direct_bone(rig,'shin.'+side,knee,ankle)
            direct_bone(rig,'foot.'+side,ankle,ankle+Vector((0,-.14,0)))
            upper=rig.data.bones['upper_arm.'+side]
            lower=rig.data.bones['forearm.'+side]
            shoulder=upper.head_local.copy()
            wrist=Vector((sign*.14,-.18,1.17+.006*math.sin(phase*math.tau)))
            elbow=arm_elbow(shoulder,wrist,upper.length,lower.length,Vector((sign*.5,-.08,1.0)))
            direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
            direct_bone(rig,'forearm.'+side,elbow,wrist)
            direct_bone(rig,'hand.'+side,wrist,wrist+Vector((-sign*.05,-.04,.09)))
        rest=rig.data.bones['head']
        tilt=Quaternion((1,0,0),math.radians(22.4))
        direct_bone(rig,'head',rest.head_local,rest.head_local+tilt@(rest.tail_local-rest.head_local))
        # Pose-bone location is in its rest axes, not world XYZ.
        # Set an absolute bone matrix through the same joint helper as the limbs.
        direct_bone(rig,'root',(0,-.76,.60742),(0,-.66,.60742))
        bpy.context.view_layer.update()
        return
    seated = action in ('read','sit')
    offset = Vector((0, -.06 if seated else 0, -.33 if seated else (walk_hip(phase)-.86 if action=='walk' else 0)))
    torso_rotation = Quaternion((1,0,0),math.radians(5+1.2*math.sin(phase*math.tau))) if action=='watch_fish' else Quaternion()
    spine_origin = Vector((0,0,1.03))+offset
    def torso_point(point):
        return spine_origin+torso_rotation@(point+offset-spine_origin)
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        direct_bone(rig, name, torso_point(rest.head_local) if name!='hips' else rest.head_local+offset,
                    torso_point(rest.tail_local) if name!='hips' else rest.tail_local+offset)
    if action in ('read','stand_read','watch_fish','talk','sit'):
        rest = rig.data.bones['head']
        base = {'read':9,'stand_read':12,'watch_fish':10,'talk':0,'sit':0}[action]
        tilt = Quaternion((1,0,0), math.radians(base + 2*math.sin(phase*math.tau)))
        direct_bone(rig, 'head', torso_point(rest.head_local), torso_point(rest.head_local)+torso_rotation@tilt@(rest.tail_local-rest.head_local))
    if action=='stand_read':
        rest=rig.data.bones['book']
        direct_bone(rig,'book',rest.head_local+Vector((0,0,.33)),rest.tail_local+Vector((0,0,.33)))
    for side, sign in (('L', -1), ('R', 1)):
        hip = Vector((sign*.124, offset.y, .86+offset.z))
        if seated or action=='walk':
            ankle_y, ankle_z = (-.355, .13) if seated else walk_ankle(phase + (0 if side=='L' else .5))
            ankle = Vector((sign*.124, ankle_y, ankle_z))
            knee_y, knee_z = knee_point((hip.y,hip.z), (ankle.y,ankle.z), .37,.36)
            knee = Vector((sign*.124,knee_y,knee_z))
            direct_bone(rig, 'thigh.'+side, hip, knee)
            direct_bone(rig, 'shin.'+side, knee, ankle)
            foot_phase=(phase+(0 if side=='L' else .5))%1
            toe_lift=.025*math.sin((foot_phase-.5)*2*math.pi) if action=='walk' and foot_phase>.5 else 0
            direct_bone(rig, 'foot.'+side, ankle, ankle+Vector((0,-.14,toe_lift)))
        shoulder = torso_point(rig.data.bones['upper_arm.'+side].head_local)
        upper_rest = rig.data.bones['upper_arm.'+side]
        lower_rest = rig.data.bones['forearm.'+side]
        if action in ('read','stand_read'):
            wrist = Vector((sign*.165,-.290,.902+(.33 if action=='stand_read' else 0)+.010*math.sin(phase*math.tau)))
            if side=='L':
                wrist = Vector((-.165,-.300,.826+(.33 if action=='stand_read' else 0)+.003*math.sin(phase*math.tau)))
            elbow = arm_elbow(shoulder,wrist,upper_rest.length,lower_rest.length,Vector((sign*.6,.02,.7)))
            tip = wrist+Vector((-sign*.042,-.095,-.025))
            if side=='L':
                tip = wrist+Vector((.042,-.095,.012))
        elif action=='sit':
            wrist = Vector((sign*.205,-.12,.61+.004*math.sin(phase*math.tau)))
            elbow = arm_elbow(shoulder,wrist,upper_rest.length,lower_rest.length,Vector((sign*.5,.02,.68)))
            tip = wrist+Vector((-sign*.018,-.105,-.022))
        elif action=='eat' and side=='R':
            raised = (1-math.cos(phase*math.tau))/2
            wrist = Vector((.19-.07*raised,-.22,1.09+.33*raised))
            elbow = arm_elbow(shoulder,wrist,upper_rest.length,lower_rest.length,Vector((.65,.02,1.0)))
            tip = wrist+Vector((-.03,-.025,.103))
        elif action=='talk' and side=='R':
            wrist = Vector((.28+.055*math.sin(phase*math.tau),-.20,1.03+.055*math.cos(phase*math.tau)))
            elbow = arm_elbow(shoulder,wrist,upper_rest.length,lower_rest.length,Vector((.6,.02,1.05)))
            tip = wrist+Vector((.025,-.080,.065))
        elif action=='walk':
            angle = math.radians(18)*math.sin(phase*math.tau+(0 if side=='L' else math.pi))
            upper_rotation = Quaternion((1,0,0), angle)
            lower_rotation = Quaternion((1,0,0), angle-math.radians(10))
            elbow = shoulder+upper_rotation@(upper_rest.tail_local-upper_rest.head_local)
            wrist = elbow+lower_rotation@(lower_rest.tail_local-lower_rest.head_local)
            tip = wrist+lower_rotation@Vector((0,-.015,-.11))
        else:
            elbow = torso_point(upper_rest.tail_local)
            wrist = torso_point(lower_rest.tail_local)
            tip = torso_point(rig.data.bones['hand.'+side].tail_local)
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direct_bone(rig, 'hand.'+side, wrist, tip)


def create_actions(rig):
    actions = {}
    rig.animation_data_create()
    for name, (count, fps) in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        for index in range(count+1):
            pose(rig, name, (index % count)/count)
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.keyframe_insert('location', frame=1+index)
                bone.keyframe_insert('rotation_quaternion', frame=1+index)
                bone.keyframe_insert('scale', frame=1+index)
            rig.keyframe_insert(data_path='["eyes_closed"]',frame=1+index)
            rig.keyframe_insert(data_path='["book_visible"]',frame=1+index)
        actions[name] = action
        action['sample_fps'] = fps
        action['loop_samples'] = count
    return actions


def main():
    assert bpy.app.background, 'Background mode is required.'
    REVIEW.mkdir(exist_ok=True)
    EXPORT.mkdir(exist_ok=True)
    status('running', stage='opening accepted source')
    source = BASE/'source/approved-neutral.blend'
    assert digest(source) == EXPECTED_SOURCE, 'Approved source hash changed.'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    parts = [obj for obj in bpy.data.objects if obj.type in ('MESH','CURVE') and not obj.hide_render]
    original = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in parts:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        mesh.transform(obj.matrix_world)
        original[obj.name] = [v.co.copy() for v in mesh.vertices]
        if obj.type == 'CURVE':
            old_name = obj.name
            obj.name = old_name+'_source_curve'
            replacement = bpy.data.objects.new(old_name, mesh)
            bpy.context.collection.objects.link(replacement)
            obj.hide_render = True
            obj.hide_set(True)
            parts[parts.index(obj)] = replacement
        else:
            # Deform the editable control cage before its original subdivision.
            # Subdividing an already bent elbow keeps its skin and cuff overlap smooth.
            if any(mod.type != 'SUBSURF' for mod in obj.modifiers):
                obj.data = mesh
                obj.modifiers.clear()
            else:
                control_mesh = obj.data.copy()
                control_mesh.transform(obj.matrix_world)
                obj.data = control_mesh
            obj.parent = None
            obj.matrix_world = Matrix.Identity(4)
    rig = make_rig(parts)
    bpy.context.view_layer.update()
    neutral_error = 0.0
    neutral_parts = {}
    for obj in parts:
        mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        assert len(mesh.vertices) == len(original[obj.name])
        neutral_parts[obj.name] = max((a.co-b).length for a,b in zip(mesh.vertices,original[obj.name]))
        neutral_error = max(neutral_error,neutral_parts[obj.name])
        obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    (BASE/'neutral-comparison.json').write_text(json.dumps(neutral_parts,indent=2))
    assert neutral_error < 1e-5, neutral_error
    book = make_book(rig)
    sleep_lids = make_sleep_lids(rig)
    configure_visibility(rig,parts,book,sleep_lids)
    actions = create_actions(rig)
    rig.animation_data.action = actions['idle']
    scene.frame_set(1)
    rig['source_sha256'] = EXPECTED_SOURCE
    rig['neutral_max_vertex_error'] = neutral_error
    rig['coordinate_convention'] = 'front -Y, right +X, up +Z; runtime SE=90 SW=0 NW=270 NE=180 degrees about Z'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.resolution_x = 608
    scene.render.resolution_y = 1408
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.fps = 10
    scene.frame_start, scene.frame_end = 1, 8
    if hasattr(scene, 'eevee'):
        scene.eevee.taa_render_samples = 32
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    proof = {'source_sha256': EXPECTED_SOURCE,'neutral_max_vertex_error':neutral_error,
             'bound_visual_objects':len(parts), 'bones':len(rig.data.bones),'actions':list(actions),
             'weights':'Every visual vertex has nonnegative normalized weights; head and face are rigid head attachments.'}
    (BASE/'rig-proof.json').write_text(json.dumps(proof,indent=2))
    # Report raw projected bounds. Do not fit individual silhouettes to the canvas;
    # the runtime chair contact owns seated registration.
    offsets = {}
    pixel_offsets = {}
    camera_right = scene.camera.matrix_world.to_quaternion() @ Vector((1,0,0))
    camera_up = scene.camera.matrix_world.to_quaternion() @ Vector((0,1,0))
    origin = world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
    projection = np.array([camera_right,camera_up],dtype=np.float64).T * (88/scene.camera.data.ortho_scale)
    projected = {}
    for action,(count,_) in CLIPS.items():
        for facing,angle in FACINGS.items():
            rig.rotation_euler.z = math.radians(angle)
            rig.animation_data.action = actions[action]
            offsets[facing] = [0,0,0]
            pixel_offsets[facing] = [0,0]
            for index in range(count):
                scene.frame_set(index+1)
                boxes = {}
                visible_parts=[obj for obj in parts if action!='sleep' or not obj.name.startswith(EYE_PREFIXES)]
                visible_parts+=book if action in ('read','stand_read') else []
                visible_parts+=sleep_lids if action=='sleep' else []
                for obj in visible_parts:
                    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    mesh = evaluated.to_mesh()
                    coords = np.empty(len(mesh.vertices)*3,dtype=np.float32)
                    mesh.vertices.foreach_get('co',coords)
                    transform = np.array(evaluated.matrix_world)
                    world = coords.reshape(-1,3) @ transform[:3,:3].T + transform[:3,3]
                    points = world @ projection + np.array([origin.x*38,origin.y*88])
                    boxes[obj.name] = [float(points[:,0].min()),float(88-points[:,1].max()),float(points[:,0].max()),float(88-points[:,1].min())]
                    evaluated.to_mesh_clear()
                pelvis = world_to_camera_view(scene,scene.camera,rig.matrix_world @ rig.pose.bones['hips'].head)
                projected[f'{action}-{facing}-{index}'] = {'pelvis_pixel':[pelvis.x*38,88-pelvis.y*88], 'parts':boxes,
                    'bounds':[min(b[0] for b in boxes.values()),min(b[1] for b in boxes.values()),max(b[2] for b in boxes.values()),max(b[3] for b in boxes.values())]}
                if action=='eat':
                    grip_local = rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303,-.075,.737))
                    grip_world = rig.matrix_world @ rig.pose.bones['hand.R'].matrix @ grip_local
                    grip = world_to_camera_view(scene,scene.camera,grip_world)
                    projected[f'{action}-{facing}-{index}']['hand_anchor'] = [grip.x*38,88-grip.y*88]
                    projected[f'{action}-{facing}-{index}']['hand_in_front'] = gripping_depth(scene,rig,parts,grip_world)['hand_in_front']
    (BASE/'projected-bounds.json').write_text(json.dumps(projected,indent=2))
    (BASE/'seated-framing.json').write_text(json.dumps({'camera_scale':scene.camera.data.ortho_scale,'root_offsets':offsets,'pixel_offsets':pixel_offsets},indent=2))
    original_scale = scene.camera.data.ortho_scale
    original_camera_location = scene.camera.location.copy()
    landmark_proof = {}
    for action,(width,height) in CANVASES.items():
        crop_shift_y=-8 if action=='sleep' else 0
        scene.camera.location=original_camera_location+camera_up*(crop_shift_y*original_scale/88)
        scene.render.resolution_x = width*16
        scene.render.resolution_y = height*16
        scene.camera.data.ortho_scale = original_scale*max(width,height)/88
        bpy.context.view_layer.update()
        check = world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
        shift = [check.x*width-origin.x*38,(1-check.y)*height-(1-origin.y)*88]
        expected = [(width-38)/2,(height-88)/2+crop_shift_y]
        assert max(abs(a-b) for a,b in zip(shift,expected)) < 1e-4, (action,shift,expected)
        world_origin = [check.x*width,(1-check.y)*height]
        landmark_proof[action] = {'width':width,'height':height,'anchor':[world_origin[0],world_origin[1]+21],
                                 'world_origin':world_origin,'origin_pixel_shift':shift,'camera_ortho_scale':scene.camera.data.ortho_scale}
        landmark_proof[action]['camera_location']=list(scene.camera.location)
    (BASE/'registered-canvas-proof.json').write_text(json.dumps(landmark_proof,indent=2))
    # A small early sheet can be reviewed while the remaining loop frames render.
    jobs = [('idle','SE',0),('walk','SE',0),('walk','SE',2),('read','SE',0)]
    jobs += [(name,facing,index) for name,(count,_) in CLIPS.items() for facing in FACINGS for index in range(count) if (name,facing,index) not in jobs]
    if '--only-new' in sys.argv:
        jobs = [job for job in jobs if job[0] not in ('idle','walk','read')]
    for argument in sys.argv:
        if argument.startswith('--only='):
            requested=argument.split('=',1)[1].split(',')
            jobs=[job for job in jobs if job[0] in requested]
    # Render the serialized editable artifact, not transient construction state.
    # This also rebuilds subdivision and driver evaluation from the saved source.
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    scene=bpy.context.scene
    rig=bpy.data.objects['SIM_01_SHARED_RIG']
    actions={name:bpy.data.actions[name] for name in CLIPS}
    parts=[bpy.data.objects[name] for name in original]
    book=[obj for obj in bpy.data.objects if obj.type=='MESH' and obj.parent==rig and 'book' in obj.name.lower()]
    sleep_lids=[obj for obj in bpy.data.objects if obj.name.startswith('Sleep closed eyelid')]
    for number,(name,facing,index) in enumerate(jobs):
        apply_render_job(scene,rig,landmark_proof,name,facing,index)
        path = REVIEW/f'{name}-{facing}-{index}.png'
        scene.render.filepath = str(path)
        status('running',stage='rendering', completed=number,total=len(jobs),current=path.name)
        bpy.ops.render.render(write_still=True)
    status('complete',stage='full-size renders ready',frames=sum(count*4 for count,_ in CLIPS.values()),proof=proof)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        status('failed',traceback=traceback.format_exc())
        raise
