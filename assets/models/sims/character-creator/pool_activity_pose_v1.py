"""One source-space pool, ladder and swimmer trajectory, in metres."""
import math
import bpy
from mathutils import Matrix, Vector, Quaternion
from build_rig import direct_bone, arm_elbow

ENTRY_SAMPLES = 41
PADDLE_SAMPLES = 12
EXIT_SAMPLES = 41

# Hip, left sole and right sole. Repeated supports remain planted while the body rises.
KEYS = [
    (0., (-.5,1.50,.835), (-.624,1.50,.0), (-.376,1.50,.0), 0.),
    (.1, (-.5,1.37,.80), (-.624,1.145,.20), (-.376,1.50,.0), 12.),
    (.2, (-.5,1.27,1.00), (-.624,1.145,.20), (-.376,1.145,.40), 18.),
    (.3, (-.5,1.20,1.15), (-.624,1.145,.60), (-.376,1.145,.40), 23.),
    (.4, (-.5,1.14,1.28), (-.624,1.145,.60), (-.376,1.145,.80), 30.),
    (.5, (-.5,.98,1.35), (-.624,.98,.90), (-.376,1.145,.80), 35.),
    (.6, (-.5,.80,1.20), (-.624,.83,.80), (-.376,.98,.90), 42.),
    (.7, (-.5,.60,.95), (-.624,.83,.60), (-.376,.83,.80), 55.),
    (.8, (-.5,.40,.70), (-.624,.83,.40), (-.376,.83,.60), 65.),
    (.9, (-.25,.25,.64), (-.374,.60,.14), (-.126,.60,.14), 70.),
    (1., (0.,.25,.64), (-.124,.60,.14), (.124,.60,.14), 70.),
]

def mix(a,b,t): return Vector(a).lerp(Vector(b),t)
def entry(t):
    for left,right in zip(KEYS,KEYS[1:]):
        if t<=right[0]:
            u=max(0.,min(1.,(t-left[0])/(right[0]-left[0])));s=u*u*(3-2*u)
            feet=[]
            for index in [2,3]:
                point=mix(left[index],right[index],s)
                if left[index]!=right[index]:point.z+=.055*math.sin(math.pi*u)
                feet.append(point)
            return mix(left[1],right[1],s),feet,left[4]*(1-s)+right[4]*s
    return Vector(KEYS[-1][1]),[Vector(KEYS[-1][2]),Vector(KEYS[-1][3])],KEYS[-1][4]

def orient(rig,name,head,rotation):
    rest=rig.data.bones[name]
    rig.pose.bones[name].matrix=Matrix.Translation(head)@rotation.to_matrix().to_4x4()@rest.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()

def rail(t):
    # Evaluate the actual authored handrail, including its automatic Bezier handles.
    obj=bpy.data.objects['Pool ladder rail 1']
    points=obj.data.splines[0].bezier_points
    f=5-max(0.,min(1.,(t-.1)/.55))*4
    i=min(len(points)-2,int(f));u=f-i
    a,b=points[i],points[i+1]
    return obj.matrix_world@((1-u)**3*a.co+3*(1-u)**2*u*a.handle_right+3*(1-u)*u*u*b.handle_left+u**3*b.co)

def apply(rig,t,paddle=0.):
    rig.matrix_world=Matrix.Identity(4)
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    hip,soles,angle=entry(t)
    swimming=t>=1.
    if swimming:
        soles=[p+Vector((0,.025*math.sin(math.tau*paddle+sign),.025*math.cos(math.tau*paddle+sign))) for p,sign in zip(soles,[0,math.pi])]
    turn=Quaternion((1,0,0),math.radians(angle))
    orient(rig,'hips',hip,turn)
    orient(rig,'spine',rig.pose.bones['hips'].tail.copy(),turn)
    head=rig.pose.bones['spine'].head+turn@(rig.data.bones['head'].head_local-rig.data.bones['spine'].head_local)
    orient(rig,'head',head,Quaternion((1,0,0),math.radians(min(angle,18))))
    contacts=[]
    for side,sign,sole in zip(['L','R'],[-1,1],soles):
        thigh=rig.pose.bones['thigh.'+side].head.copy()
        ankle=sole+Vector((0,0,.1108519))
        upper=rig.data.bones['thigh.'+side].length;lower=rig.data.bones['shin.'+side].length
        knee=arm_elbow(thigh,ankle,upper,lower,thigh+Vector((0,-1,0)))
        direct_bone(rig,'thigh.'+side,thigh,knee);direct_bone(rig,'shin.'+side,knee,ankle)
        orient(rig,'foot.'+side,ankle,Quaternion())
        shoulder=rig.pose.bones['upper_arm.'+side].head.copy()
        enter_weight=max(0.,min(1.,(t-.025)/.075))
        leave_weight=max(0.,min(1.,(.60-t)/.12))
        grip_weight=enter_weight*leave_weight
        wave=math.sin(math.tau*paddle+(0 if side=='L' else math.pi)) if swimming else 0
        swim_palm=Vector((hip.x+sign*(.25+.025*wave),-.48-.08*wave,.805+.020*math.cos(math.tau*paddle)))
        rest_palm=shoulder+Vector((sign*.065,-.24 if t>.45 else -.04,-.25 if t>.45 else -.39))
        weight=max(0.,min(1.,(t-.65)/.35))
        palm=rest_palm.lerp(swim_palm,weight)
        rotation=Quaternion((1,0,0),math.radians(-70*weight))
        if grip_weight:
            r=rail(t);palm=palm.lerp(Vector((-.5+sign*(.18-.013),r.y,r.z)),grip_weight)
            rotation=rotation.slerp(Quaternion((1,0,0),math.radians(-35)),grip_weight)
        reference=Vector((sign*.303,-.075,.737));rest_head=rig.data.bones['hand.'+side].head_local
        wrist=palm-rotation@(reference-rest_head)
        elbow=arm_elbow(shoulder,wrist,rig.data.bones['upper_arm.'+side].length,
            rig.data.bones['forearm.'+side].length,shoulder+Vector((sign,.1,0)))
        direct_bone(rig,'upper_arm.'+side,shoulder,elbow);direct_bone(rig,'forearm.'+side,elbow,wrist)
        orient(rig,'hand.'+side,wrist,rotation)
        contacts.append(grip_weight)
    rig['book_visible']=0.;rig['eyes_closed']=0.
    bpy.context.view_layer.update()
    return {'assemblies':{},'handContact':contacts,'poolTravel':t}

def sample(rig,name,index):
    if name=='pool_enter':return apply(rig,index/(ENTRY_SAMPLES-1))
    if name=='pool_paddle':return apply(rig,1.,index/PADDLE_SAMPLES)
    origin=int(name.rsplit('_',1)[1])/PADDLE_SAMPLES
    t=index/(EXIT_SAMPLES-1)
    if t<.1:
        # A frozen native paddle origin blends to the shared ladder-return pose.
        return apply(rig,1.,origin if t==0 else (origin if origin<=.5 else origin-1)*(1-t/.1))
    return apply(rig,1-(t-.1)/.9)
