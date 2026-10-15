"""Export contact ownership and measured rest landmarks alongside preferred poses."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

POLICIES={
    'prepare':'work','cook_v2':'work','food_idle':'carry','food_walk':'carry',
    'carry_idle':'carry','carry_walk':'carry','wash':'wash','seated_eat':'dining',
    'mop':'mop','wipe_counter':'work','wipe_table':'work','empty_bin':'bag',
    'exercise':'exercise','toilet':'seat','bath':'bath','sofa_recline':'recline',
    'fridge':'work',
    'bed_sleep':'sleep','bunk_sleep':'sleep',
    'book_idle':'book','book_walk':'book','owned_stand_read':'book',
    'shower':'shower',
}

def matrix(value):return [float(value[row][col]) for col in range(4) for row in range(4)]

def book_hand_contact(rig,book):
    deps=bpy.context.evaluated_depsgraph_get();evaluated=book.evaluated_get(deps);mesh=evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        tree=BVHTree.FromPolygons([book.matrix_world@v.co for v in mesh.vertices],[tuple(t.vertices) for t in mesh.loop_triangles],all_triangles=True)
    finally:evaluated.to_mesh_clear()
    candidates=[]
    for side in ['L','R']:
        best=None;bone_name='hand.'+side
        for obj in bpy.data.objects:
            if obj.type!='MESH' or not any(modifier.type=='ARMATURE' and modifier.object==rig for modifier in obj.modifiers):continue
            if not any(name in obj.name for name in ['Relaxed palm','Resting thumb']):continue
            group=obj.vertex_groups.get(bone_name)
            if not group:continue
            evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=deps)
            try:
                for vertex in mesh.vertices:
                    if not any(weight.group==group.index and weight.weight>.999 for weight in vertex.groups):continue
                    point=obj.matrix_world@vertex.co;nearest=tree.find_nearest(point)
                    if nearest[0] is not None and (best is None or nearest[3]<best[0]):best=(nearest[3],point.copy())
            finally:evaluated.to_mesh_clear()
        if best is None:raise ValueError('No rigid hand contact surface for '+side)
        local=rig.data.bones[bone_name].matrix_local@rig.pose.bones[bone_name].matrix.inverted()@rig.matrix_world.inverted()@best[1]
        candidates.append((best[0],side,list(local)))
    return min(candidates,key=lambda value:value[0])

def assembly_root(obj,rig,fixture):
    current=obj
    while current.parent and current.parent not in [rig,fixture]:current=current.parent
    return current

def landmarks(rig):
    previous=rig.data.pose_position;rig.data.pose_position='REST';bpy.context.view_layer.update()
    inverse=rig.matrix_world.inverted()
    prefix='Place 1 ' if rig.name.startswith('Place 1 ') else ''
    def surface(name,selector):
        obj=bpy.data.objects[prefix+name]
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
        try:
            points=[inverse@obj.matrix_world@vertex.co for vertex in mesh.vertices]
            chosen=selector(points)
            vertex=mesh.vertices[chosen]
            groups={group.index:group.name for group in obj.vertex_groups}
            weights=[(groups[group.group],group.weight) for group in vertex.groups if groups.get(group.group) in rig.data.bones and group.weight>0]
            total=sum(weight for _,weight in weights)
            return {'point':list(points[chosen]),'weights':[[name,weight/total] for name,weight in weights]}
        finally:evaluated.to_mesh_clear()
    pelvis=surface('Trouser hip bridge',lambda points:min(range(len(points)),key=lambda i:points[i].z))
    back=surface('Overshirt body',lambda points:max(range(len(points)),key=lambda i:points[i].y if 1.15<points[i].z<1.30 else -100))
    mouth=surface('Quiet closed smile',lambda points:min(range(len(points)),key=lambda i:abs(points[i].x)))
    mouth['point'][1]-=.055
    rig.data.pose_position=previous;bpy.context.view_layer.update()
    exercise={}
    for side in ['L','R']:
        hand=rig.data.bones['hand.'+side]
        exercise['exercisePalm'+side]={'point':list(hand.head_local+(hand.tail_local-hand.head_local).normalized()*.073),'weights':[['hand.'+side,1]],'region':4}
    return {'pelvis':{**pelvis,'region':3},'back':{**back,'region':2},'mouth':{**mouth,'region':1},**exercise,
        'palmL':{'point':[-.303,-.075,.737],'weights':[['hand.L',1]],'region':4},
        'palmR':{'point':[.303,-.075,.737],'weights':[['hand.R',1]],'region':4}}

def definition(action,rest_landmarks,owners):
    selected=dict(rest_landmarks)
    if action=='exercise':
        for side in ['L','R']:selected['palm'+side]=selected['exercisePalm'+side]
    policy=('seat_book' if action.endswith('_read') else 'seat') if action.startswith('seat_') else 'book_reach' if action.startswith(('fetch_','shelve_')) else POLICIES[action]
    result={'version':1,'space':'rig','policy':policy,'landmarks':selected,'assemblies':owners}
    if action=='exercise':
        from geometry import AXLE,CRANK_RADIUS,PEDAL_HALF_SPACING,PEDAL_THICKNESS
        result['bike']={'axle':list(AXLE),'radius':CRANK_RADIUS,'halfSpacing':PEDAL_HALF_SPACING,
            'pedalTop':PEDAL_THICKNESS/2,'flywheelFace':.164}
    if action=='seated_eat':result['dining']={'spoon':'Eating spoon','plate':'Dinner on table','length':.175,'food':[.08,-.67,.835]}
    if action in ['wipe_counter','wipe_table']:
        result['surfaceWork']={'assembly':action+' cloth holder','hand':1,'axis':[1,0,0],'range':[-.03,.23]}
    if action in ['food_idle','food_walk']:result['carry']={'assembly':'Carried dinner','translationMin':[-.10,-.15,-.12],'translationMax':[.10,.15,.12]}
    if action in ['carry_idle','carry_walk','wash']:result['carry']={'assembly':'Held used plate','translationMin':[-.10,-.15,-.12],'translationMax':[.10,.15,.12]}
    if action=='empty_bin':result['bag']={'assembly':'Lifted waste bag','release':.98,'liftStart':.10,'liftEnd':.55}
    if action=='mop':result['mop']={'shaft':'Mop shaft','head':'Mop head holder','sleeve':'Mop handle sleeve',
        'rightFraction':.69,'leftRange':[.76,.94],'leftPreferred':.84}
    if action=='bath':result['feet']={'kind':'basin','forwardRange':[.20,.66]}
    if action in ['toilet','seated_eat'] or action.startswith('seat_'):result['feet']={'kind':'floor','forwardRange':[-.80,-.08]}
    return result

def frame(action,phase,rig,props,fixture):
    inverse=rig.matrix_world.inverted()
    roots={assembly_root(obj,rig,fixture) for obj in props if obj.get('creator_owner')=='actor' or not (fixture and assembly_root(obj,rig,fixture).parent==fixture)}
    values={root.name:matrix(inverse@root.matrix_world) for root in roots}
    result={'assemblies':values}
    if action.startswith(('fetch_','shelve_')):
        canonical=bool(rig.get('book_visible',0)>=.5)
        result['bookHeld']=canonical
        if canonical:result['handContact']=[1,1]
        else:
            slot=int(action.rsplit('_',1)[1]);moving=next(obj for obj in props if obj.get('creator_stock_slot')==slot)
            if moving.get('creator_owner')=='actor':result['heldAssembly']=assembly_root(moving,rig,fixture).name
            gap,side,reference=book_hand_contact(rig,moving)
            result['palm'+side]=reference;result['sourceBookContactGap']=gap
            active=0 if side=='L' else 1
            result['handContact']=[int(active==0),int(active==1)]
    if action=='fridge':
        import fridge_reach_geometry as fridge
        index=round(phase*7)
        result['handContact']=[0 if schedule[index]=='rest' else 1 for schedule in [fridge.LEFT_HAND,fridge.RIGHT_HAND]]
        regions=[]
        for side,schedule in zip(['L','R'],[fridge.LEFT_HAND,fridge.RIGHT_HAND]):
            mode=schedule[index]
            if mode=='rest':regions.append(None);continue
            hand=rig.pose.bones['hand.'+side]
            reference=Vector((-.303 if side=='L' else .303,-.075,.737))
            grip=rig.matrix_world@hand.matrix@rig.data.bones['hand.'+side].matrix_local.inverted()@reference
            low,high=([-.30,-.42,1.08],[.30,-.32,1.29]) if mode=='reach' else (
                [grip.x,grip.y,.68 if mode=='handle' else .25],[grip.x,grip.y,1.00 if mode=='handle' else 1.32])
            corners=[inverse@Vector((x,y,z)) for x in [low[0],high[0]] for y in [low[1],high[1]] for z in [low[2],high[2]]]
            regions.append({'mode':mode,'min':[min(p[i] for p in corners) for i in range(3)],'max':[max(p[i] for p in corners) for i in range(3)]})
        result['handRegions']=regions
    if action=='seated_eat':result['raise']=(1-math.cos(phase*math.tau))/2
    if action=='empty_bin':result['lift']=min(1,max(0,(phase-.10)/.45))
    if action=='mop':
        wave=math.sin(phase*math.tau)
        result['shaft']={'bottom':[.14*wave,-.38-.035*math.cos(phase*math.tau),0],'top':[.025*wave,-.30,1.50]}
        for side,fraction in [('R',.69),('L',.84)]:
            center=Vector(result['shaft']['bottom']).lerp(Vector(result['shaft']['top']),fraction)
            rest=rig.data.bones['hand.'+side].matrix_local
            result['palm'+side]=list(rest@rig.pose.bones['hand.'+side].matrix.inverted()@center)
    return result
