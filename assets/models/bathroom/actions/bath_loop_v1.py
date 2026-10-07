"""Versioned quiet bathing loop; restore the accepted local channels every sample.

Only the head moves: a gentle nod of up to three degrees about the head's own side axis.
Everything under the water line, the pelvis seat, the back against the wall, the arms and the
legs stay exactly at the accepted frame, so the certified support and clearance hold for every
sample without re-measurement; the loop renderer still re-measures each sample.
"""
import math

ACTION_NAME = 'bath_idle_v1'
FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
STATIC_BONES = ('root', 'hips', 'spine', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
                'upper_arm.L', 'forearm.L', 'hand.L', 'upper_arm.R', 'forearm.R', 'hand.R', 'book')
MAX_NOD_DEGREES = 3.


def head_nod(phase):
    """Degrees of forward head nod at a loop phase in [0, 1); zero at phase zero and one."""
    if not math.isfinite(phase):
        raise ValueError('Loop phase must be finite')
    phase %= 1
    return MAX_NOD_DEGREES/2*(1-math.cos(math.tau*phase))


def sample_phase(index, reduced_motion=False):
    if type(index) is not int or not 0 <= index < 4:
        raise ValueError('Quiet loop needs one of four sample indices')
    return 0 if reduced_motion else index/4


def render_jobs():
    return [(facing, frame, owner) for facing in FACINGS for frame in range(4) for owner in OWNERS]


def ink_jobs():
    return [(facing, frame) for facing in FACINGS for frame in range(4)]


def capture_baseline(rig):
    return dict(channels={b.name:dict(location=tuple(b.location), scale=tuple(b.scale), rotation_mode=b.rotation_mode,
        rotation_quaternion=tuple(b.rotation_quaternion), rotation_euler=tuple(b.rotation_euler),
        rotation_axis_angle=tuple(b.rotation_axis_angle)) for b in rig.pose.bones},
        targets={b.name:dict(head=tuple(b.head), tail=tuple(b.tail)) for b in rig.pose.bones},
        matrices={b.name:b.matrix.copy() for b in rig.pose.bones},
        properties={name:rig[name] for name in ('book_visible', 'eyes_closed')})


def restore_baseline(rig, baseline):
    import bpy
    if set(baseline['channels']) != {b.name for b in rig.pose.bones} or len(baseline['channels']) != 17:
        raise ValueError('Accepted loop baseline needs all seventeen bones')
    for b in rig.pose.bones:
        for name, value in baseline['channels'][b.name].items():
            setattr(b, name, value)
    for name, value in baseline['properties'].items():
        rig[name] = value
    bpy.context.view_layer.update()


def apply_phase(rig, baseline, phase):
    import bpy
    from mathutils import Matrix, Vector
    restore_baseline(rig, baseline)
    nod = head_nod(phase)
    if nod == 0:
        return dict(phase=phase, head_nod_degrees=0, baseline_restored=True, exact_quiet_sample=True)
    head = rig.pose.bones['head']
    matrix = baseline['matrices']['head'].copy()
    pivot = Vector(baseline['targets']['head']['head'])
    axis = (matrix.to_3x3()@Vector((1, 0, 0))).normalized()
    turn = Matrix.Rotation(math.radians(nod), 4, axis)
    head.matrix = Matrix.Translation(pivot)@turn@Matrix.Translation(-pivot)@matrix
    bpy.context.view_layer.update()
    if (Vector(head.head)-pivot).length > 1e-6:
        raise ValueError('Head nod moved the head joint')
    for name in STATIC_BONES:
        bone = rig.pose.bones[name]
        if max(abs(a-b) for field in ('head', 'tail')
               for a, b in zip(getattr(bone, field), baseline['targets'][name][field])) > 1e-7:
            raise ValueError('Quiet loop moved a static accepted bone: '+name)
    return dict(phase=phase, head_nod_degrees=nod, baseline_restored=True, head_joint_fixed=True,
                static_body_and_limbs=True)


def bake(rig, baseline):
    import bpy
    rig.animation_data_create()
    action = bpy.data.actions.new(ACTION_NAME)
    action.use_fake_user = True
    rig.animation_data.action = action
    for index in range(5):
        apply_phase(rig, baseline, index/4)
        for bone in rig.pose.bones:
            if bone.rotation_mode != 'QUATERNION':
                raise ValueError('Accepted rig loop requires quaternion local channels')
            for field in ('location', 'rotation_quaternion', 'scale'):
                bone.keyframe_insert(field, frame=index+1)
        for name in baseline['properties']:
            rig.keyframe_insert(data_path='["'+name+'"]', frame=index+1)
    if getattr(action, 'is_action_legacy', True):
        curves = list(action.fcurves)
    else:
        curves = [curve for layer in action.layers for strip in layer.strips
                  for bag in strip.channelbags for curve in bag.fcurves]
    if not curves:
        raise ValueError('Baked loop has no recorded local-channel curves')
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    action['loop_samples'] = 4
    action['loop_ticks'] = 16
    action['half_cycle_ticks'] = 8
    action['sample_fps'] = 2.5
    action['closed_endpoint_frame'] = 5
    action['baked_curve_count'] = len(curves)
    return action
