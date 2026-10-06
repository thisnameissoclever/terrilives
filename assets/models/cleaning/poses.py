"""Cleaning tools and contact poses for the existing household skeleton."""
import math
import bpy
from mathutils import Vector, Quaternion
from build_rig import pose, direct_bone, arm_elbow
from build_parts import box, cylinder, mesh, material
from mop_model import gathered_head,closed_hands,pose_grip

CLIPS = {'mop': ('Mop', 8), 'wipe_counter': ('WipeCounter', 6),
         'wipe_table': ('WipeTable', 6), 'empty_bin': ('EmptyBin', 8)}
HEIGHTS = {'wipe_counter': .86, 'wipe_table': .79}


def visible_in(obj, rig, mode, bag=False):
    driver = obj.driver_add('hide_render').driver
    for name, key in [('mode', 'cleaning_mode')] + ([('bag', 'bag_visible')] if bag else []):
        variable = driver.variables.new()
        variable.name = name
        variable.targets[0].id = rig
        variable.targets[0].data_path = f'["{key}"]'
    driver.expression = f'mode != {mode}' + (' or bag < 0.5' if bag else '')


def tools(rig):
    wood = material('Mop handle wood', (.42, .31, .19))
    rubber = material('Mop rubber grip', (.10, .14, .15))
    cotton = material('Mop cotton strands', (.80, .77, .66))
    linen = material('Wiping cloth blue', (.24, .53, .61))
    plastic = material('Waste bag dark plastic', (.075, .095, .10))
    tie = material('Waste bag tie', (.39, .37, .29))
    head = bpy.data.objects.new('Mop head holder', None)
    bpy.context.collection.objects.link(head); head.parent = rig
    gathered_head(head,cotton,linen,rubber)
    shaft = cylinder('Mop shaft', (0,0,0), (0,0,1), .014, wood, rig)
    grip = cylinder('Mop handle sleeve', (0,0,-.07), (0,0,.07), .023, rubber, rig)
    for obj in [shaft, grip, *head.children]: visible_in(obj, rig, 1)
    hands=closed_hands(rig)
    for definition in hands.values():
        for obj in definition['parts']:visible_in(obj,rig,1)
    for name in ('Relaxed palm','Relaxed palm.001','Resting thumb','Resting thumb.001'):
        driver=bpy.data.objects[name].driver_add('hide_render').driver
        variable=driver.variables.new();variable.name='mode';variable.targets[0].id=rig
        variable.targets[0].data_path='["cleaning_mode"]';driver.expression='mode == 1'
    cloths = {}
    for mode, action in [(2,'wipe_counter'),(3,'wipe_table')]:
        holder = bpy.data.objects.new(action+' cloth holder', None)
        bpy.context.collection.objects.link(holder); holder.parent = rig
        body = box(action+' cloth', (0,0,.007), (.18,.14,.014), linen, holder, .006)
        fold = box(action+' cloth folded edge', (.063,0,.017), (.040,.14,.020), linen, holder,.005)
        for obj in (body,fold): visible_in(obj,rig,mode)
        cloths[action]=holder
    bag = bpy.data.objects.new('Lifted waste bag',None)
    bpy.context.collection.objects.link(bag);bag.parent=rig
    profile=[(.025,0),(.060,-.025),(.14,-.13),(.185,-.28),(.155,-.41),(.04,-.445),(0,-.445)]
    vertices=[(r*(1+.045*math.sin(i*3))*math.cos(i*math.tau/24),
               r*(1+.045*math.sin(i*3))*math.sin(i*math.tau/24),z)
              for r,z in profile for i in range(24)]
    faces=[(j*24+i,j*24+(i+1)%24,(j+1)*24+(i+1)%24,(j+1)*24+i)
           for j in range(len(profile)-1) for i in range(24)]
    body=mesh('Crumpled waste bag',vertices,faces,plastic,bag)
    knot=box('Waste bag knot',(0,0,.009),(.06,.05,.035),tie,bag,.008)
    for obj in (body,knot):visible_in(obj,rig,4,True)
    return {'head':head,'shaft':shaft,'grip':grip,'cloths':cloths,'bag':bag,'hands':hands}


def torso(rig, bend, crouch):
    offset=Vector((0,0,-crouch))
    pivot=Vector((0,0,.86))+offset
    rotation=Quaternion((1,0,0),bend)
    def point(p):return pivot+rotation@(p+offset-pivot)
    for name in ('hips','spine','head'):
        rest=rig.data.bones[name]
        direct_bone(rig,name,point(rest.head_local),point(rest.tail_local))
    for side,sign in [('L',-1),('R',1)]:
        hip=point(rig.data.bones['thigh.'+side].head_local)
        ankle=Vector((sign*.124,0,.13))
        knee=arm_elbow(hip,ankle,rig.data.bones['thigh.'+side].length,
                       rig.data.bones['shin.'+side].length,Vector((sign*.124,-.8,.45)))
        direct_bone(rig,'thigh.'+side,hip,knee)
        direct_bone(rig,'shin.'+side,knee,ankle)
        direct_bone(rig,'foot.'+side,ankle,ankle+Vector((0,-.14,0)))
    return point


def hand_on(rig, side, center, point):
    sign=-1 if side=='L' else 1
    hand=rig.data.bones['hand.'+side]
    grip_local=Vector((sign*.303,-.075,.737))
    direction=Vector((0,-.07,-.075))
    rotation=(hand.tail_local-hand.head_local).rotation_difference(direction)
    wrist=center-rotation@(grip_local-hand.head_local)
    upper=rig.data.bones['upper_arm.'+side]
    lower=rig.data.bones['forearm.'+side]
    shoulder=point(upper.head_local)
    elbow=arm_elbow(shoulder,wrist,upper.length,lower.length,Vector((sign*.65,.03,shoulder.z-.20)))
    direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
    direct_bone(rig,'forearm.'+side,elbow,wrist)
    direct_bone(rig,'hand.'+side,wrist,wrist+direction)
    actual=rig.pose.bones['hand.'+side].matrix @ hand.matrix_local.inverted() @ grip_local
    assert (actual-center).length<.00001, ('grip detached',side,actual,center)
    return list(actual)


def set_pose(rig, props, action, phase):
    pose(rig,'idle',0)
    rig['cleaning_mode']=float(list(CLIPS).index(action)+1)
    rig['bag_visible']=0.0
    wave=math.sin(phase*math.tau)
    witnesses={}
    if action=='mop':
        point=torso(rig,.12,.025)
        bottom=Vector((.14*wave,-.38-.035*math.cos(phase*math.tau),0))
        top=Vector((.025*wave,-.30,1.50))
        direction=top-bottom
        rotation=Vector((0,0,1)).rotation_difference(direction)
        props['head'].location=bottom
        shaft_bottom=bottom+direction.normalized()*.16
        props['shaft'].location=(shaft_bottom+top)/2
        props['shaft'].rotation_mode='QUATERNION';props['shaft'].rotation_quaternion=rotation
        props['shaft'].scale=(1,1,(top-shaft_bottom).length)
        right=bottom+direction*.69;left=bottom+direction*.84
        props['grip'].location=right;props['grip'].rotation_mode='QUATERNION';props['grip'].rotation_quaternion=rotation
        witnesses['mop_head']=list(bottom)
    elif action in HEIGHTS:
        height=HEIGHTS[action]
        point=torso(rig,.43 if action=='wipe_counter' else .52,.06 if action=='wipe_counter' else .09)
        cloth=Vector((.10+.13*wave,-.51+.025*math.cos(phase*math.tau),height))
        props['cloths'][action].location=cloth
        right=cloth+Vector((0,0,.045));left=Vector((-.17,-.43,height+.052))
        witnesses['cloth_surface']=list(cloth)
    else:
        # Reach, lift, tie, move the bag aside, then release it as the bin closes.
        lift=min(1.0,max(0.0,(phase-.10)/.45))
        point=torso(rig,.58*(1-lift)+.10,.21*(1-lift)+.025)
        aside=max(0.0,(phase-.72)/.28)
        mouth=Vector((.14*aside,-.57+.25*aside,.69+.51*lift-.24*aside))
        props['bag'].location=mouth
        rig['bag_visible']=float(.40<=phase<.98)
        spread=.07 if phase<.6 else .035
        right=mouth+Vector((spread,0,.03));left=mouth+Vector((-spread,0,.03))
        witnesses['bag_mouth']=list(mouth)
    if action=='mop':
        for side,label,center in [('R','right',right),('L','left',left)]:
            witnesses[label+'_wrist']=pose_grip(rig,side,center,direction.normalized(),point,props['hands'][side])
            witnesses[label+'_hand']=list(center)
    else:
        witnesses['right_hand']=hand_on(rig,'R',right,point)
        witnesses['left_hand']=hand_on(rig,'L',left,point)
    return witnesses
