"""Versioned quiet seated loop; restore the accepted local channels every sample."""
import math

ACTION_NAME = 'toilet_idle_v1'
FACINGS = {'SE':90,'NW':270,'SW':0,'NE':180}
VARIANTS = ('green','blue','red')
OWNERS = ('beauty','sim','furniture','lines')
STATIC_BONES = ('root','hips','spine','head','thigh.L','shin.L','foot.L','thigh.R','shin.R','foot.R','book')


def hand_lift(phase):
    if not math.isfinite(phase):
        raise ValueError('Loop phase must be finite')
    phase %= 1
    return .004*(1-math.cos(math.tau*phase))


def sample_phase(index,reduced_motion=False):
    if type(index) is not int or not 0<=index<4:
        raise ValueError('Quiet loop needs one of four sample indices')
    return 0 if reduced_motion else index/4


def render_jobs():
    return [(facing,variant,frame,owner) for facing in FACINGS for variant in VARIANTS
            for frame in range(4) for owner in OWNERS]


def ink_jobs():
    return [(facing,frame) for facing in FACINGS for frame in range(4)]


def capture_baseline(rig):
    return dict(channels={b.name:dict(location=tuple(b.location),scale=tuple(b.scale),rotation_mode=b.rotation_mode,
        rotation_quaternion=tuple(b.rotation_quaternion),rotation_euler=tuple(b.rotation_euler),
        rotation_axis_angle=tuple(b.rotation_axis_angle)) for b in rig.pose.bones},
        targets={b.name:dict(head=tuple(b.head),tail=tuple(b.tail)) for b in rig.pose.bones},
        matrices={b.name:b.matrix.copy() for b in rig.pose.bones},
        properties={name:rig[name] for name in ('book_visible','eyes_closed')})


def restore_baseline(rig,baseline):
    import bpy
    if set(baseline['channels'])!={b.name for b in rig.pose.bones} or len(baseline['channels'])!=17:
        raise ValueError('Accepted loop baseline needs all seventeen bones')
    for b in rig.pose.bones:
        for name,value in baseline['channels'][b.name].items():
            setattr(b,name,value)
    for name,value in baseline['properties'].items():
        rig[name]=value
    bpy.context.view_layer.update()


def apply_phase(rig,baseline,phase):
    import bpy
    from mathutils import Vector
    from build_rig import direct_bone
    from toilet_pose_geometry import two_link
    restore_baseline(rig,baseline)
    lift=hand_lift(phase)
    if lift==0:
        return dict(phase=phase,hand_lift=0,baseline_restored=True,exact_quiet_sample=True)
    for side in ('L','R'):
        shoulder=Vector(baseline['targets']['upper_arm.'+side]['head'])
        pole=Vector(baseline['targets']['upper_arm.'+side]['tail'])
        wrist=Vector(baseline['targets']['hand.'+side]['head'])+Vector((0,0,lift))
        elbow=Vector(two_link(shoulder,wrist,rig.data.bones['upper_arm.'+side].length,
                              rig.data.bones['forearm.'+side].length,pole))
        direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
        direct_bone(rig,'forearm.'+side,elbow,wrist)
        matrix=baseline['matrices']['hand.'+side].copy()
        matrix.translation=wrist
        rig.pose.bones['hand.'+side].matrix=matrix
        bpy.context.view_layer.update()
        error=max(abs(rig.pose.bones['hand.'+side].matrix[i][j]-baseline['matrices']['hand.'+side][i][j])
                  for i in range(3) for j in range(3))
        if error>1e-6:
            raise ValueError('Loop changed the accepted hand orientation')
    for name in STATIC_BONES:
        bone=rig.pose.bones[name]
        if max(abs(a-b) for field in ('head','tail')
               for a,b in zip(getattr(bone,field),baseline['targets'][name][field]))>1e-7:
            raise ValueError('Quiet loop moved a static accepted body/foot bone')
    return dict(phase=phase,hand_lift=lift,baseline_restored=True,hand_orientation_preserved=True,
                static_lower_body_fixture=True)


def bake(rig,baseline):
    import bpy
    rig.animation_data_create()
    action=bpy.data.actions.new(ACTION_NAME)
    action.use_fake_user=True
    rig.animation_data.action=action
    for index in range(5):
        apply_phase(rig,baseline,index/4)
        for bone in rig.pose.bones:
            if bone.rotation_mode!='QUATERNION':
                raise ValueError('Accepted rig loop requires quaternion local channels')
            for field in ('location','rotation_quaternion','scale'):
                bone.keyframe_insert(field,frame=index+1)
        for name in baseline['properties']:
            rig.keyframe_insert(data_path='["'+name+'"]',frame=index+1)
    if getattr(action,'is_action_legacy',True):
        curves=list(action.fcurves)
    else:
        curves=[curve for layer in action.layers for strip in layer.strips
                for bag in strip.channelbags for curve in bag.fcurves]
    if not curves:
        raise ValueError('Baked loop has no recorded local-channel curves')
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation='LINEAR'
    action['loop_samples']=4
    action['loop_ticks']=16
    action['half_cycle_ticks']=8
    action['sample_fps']=2.5
    action['closed_endpoint_frame']=5
    action['baked_curve_count']=len(curves)
    return action
