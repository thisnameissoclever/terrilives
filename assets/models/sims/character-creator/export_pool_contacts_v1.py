"""Export immutable evaluated pool solids and explicit phase support ownership."""
from pathlib import Path
import hashlib
import json
import sys
import bpy
from mathutils import Vector

BASE=Path(__file__).resolve().parent
MODELS=BASE.parents[1]
sys.path[:0]=[str(BASE),str(MODELS/'sims/sim-01')]
import pool_activity_pose_v1 as motion

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def surface(sole):
    if sole[2]==0:return 'ground:approach'
    if sole[2]==.90:return 'Pool stone coping'
    if sole[2] in [.20,.40,.60,.80]:
        side='outside' if sole[1]>.94 else 'inside'
        return f'Pool {side} ladder tread {round(sole[2]/.2)}'
    return None

def mode(kind,surface_id=None,interval=None,region=None):
    return {'mode':kind,'surface':surface_id,'interval':interval,'intervalSpace':'entry-travel','region':region}

def ownership(travel,reverse=False):
    hands=[]
    for side in [1,2]:
        if .1<=travel<=.48:kind='support';interval=[.1,.48]
        elif .025<travel<.1:kind='approach';interval=[.025,.1]
        elif .48<travel<.60:kind='release';interval=[.48,.60]
        else:kind='free';interval=None
        if reverse and kind in ['approach','release']:kind='release' if kind=='approach' else 'approach'
        hands.append(mode(kind,f'Pool ladder rail {side}' if kind!='free' else None,interval,
            {'kind':'rail','parameter':[1.,5.]} if kind!='free' else None))
    feet=[]
    for foot in [2,3]:
        record=mode('free')
        if travel<.9:
            for left,right in zip(motion.KEYS,motion.KEYS[1:]):
                if left[0]<=travel<right[0]:
                    a,b=left[foot],right[foot];u=(travel-left[0])/(right[0]-left[0])
                    if a==b:record=mode('support',surface(a),[left[0],right[0]],{'kind':'top-face'})
                    elif u<.25 and surface(a):record=mode('release',surface(a),[left[0],right[0]],{'kind':'top-face'})
                    elif u>.75 and surface(b):record=mode('approach',surface(b),[left[0],right[0]],{'kind':'top-face'})
                    break
        if reverse and record['mode'] in ['approach','release']:
            record['mode']='release' if record['mode']=='approach' else 'approach'
        feet.append(record)
    return {'handL':hands[0],'handR':hands[1],'footL':feet[0],'footR':feet[1]}

def run():
    assert bpy.app.background
    catalog=json.loads((MODELS/'static-props-07.json').read_text())
    entry=next(row for row in catalog['objects'] if row['name']=='offlinePool')
    directory=MODELS/entry['directory'];proof=json.loads((directory/'proof.json').read_text())
    source=directory/'pool-authoring.blend'
    assert digest(source)==proof['model_sha256']
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    root=bpy.data.objects['POOL_MODEL_ROOT'];inverse=root.matrix_world.inverted()
    graph=bpy.context.evaluated_depsgraph_get();solids=[];rails=[]
    for obj in sorted(root.children_recursive,key=lambda item:item.name):
        if obj.type not in ['MESH','CURVE'] or obj.name=='Pool water surface':continue
        evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
        try:
            transform=inverse@obj.matrix_world
            vertices=[list(transform@v.co) for v in mesh.vertices]
            triangles=[list(triangle.vertices) for triangle in mesh.loop_triangles]
            solids.append({'id':obj.name,'kind':'floor' if obj.name=='Pool basin floor' else 'solid',
                'vertices':vertices,'triangles':triangles,
                'bounds':[[min(v[i] for v in vertices) for i in range(3)],[max(v[i] for v in vertices) for i in range(3)]]})
        finally:evaluated.to_mesh_clear()
        if obj.name.startswith('Pool ladder rail '):
            points=obj.data.splines[0].bezier_points;transform=inverse@obj.matrix_world
            rails.append({'id':obj.name,'radius':float(obj.data.bevel_depth),
                'points':[{'point':list(transform@p.co),'left':list(transform@p.handle_left),'right':list(transform@p.handle_right)} for p in points]})
    library=json.loads((BASE/'clips/clips.json').read_text());clips={}
    boundaries={0.,1.,.025,.1,.48,.60,.9}
    for left,right in zip(motion.KEYS,motion.KEYS[1:]):
        boundaries.update([left[0],right[0],left[0]+(right[0]-left[0])*.25,left[0]+(right[0]-left[0])*.75])
    for name,clip in library['clips'].items():
        if clip['family']!='pool':continue
        clips[name]={'playback':clip['playback'],'samples':[
            {'phase':index/(len(clip['samples']) if clip['playback']=='loop' else len(clip['samples'])-1),
             'travel':sample['contacts']['poolTravel'],'limbs':ownership(sample['contacts']['poolTravel'],name.startswith('pool_exit_')),
             'rootRegion':{'anchor':'hips','reference':'authored','minimum':[0.,0.,0.] if sample['contacts']['poolTravel']==1 else [-.10,-.18,-.20],
                 'maximum':[0.,0.,0.] if sample['contacts']['poolTravel']==1 else [.10,.18,.16]}}
            for index,sample in enumerate(clip['samples'])]}
        reverse=name.startswith('pool_exit_')
        cuts=sorted({0.,1.} if name=='pool_paddle' else {0.,.1,1.,*(.1+(1-b)*.9 for b in boundaries)} if reverse else boundaries)
        intervals=[]
        for start,end in zip(cuts,cuts[1:]):
            phase=(start+end)/2;travel=1. if name=='pool_paddle' or reverse and phase<.1 else 1-(phase-.1)/.9 if reverse else phase
            limbs=ownership(travel,reverse)
            for limb in limbs.values():limb['interval']=[start,end];limb['intervalSpace']='clip-phase'
            intervals.append({'start':start,'end':end,'limbs':limbs})
        clips[name]['intervals']=intervals
    by_id={solid['id']:solid for solid in solids}
    for clip in clips.values():
        for sample in [*clip['samples'],*clip['intervals']]:
            for support in sample['limbs'].values():
                if not support['region'] or support['region']['kind']!='top-face' or support['surface']=='ground:approach':continue
                solid=by_id[support['surface']];selected=[]
                for index,triangle in enumerate(solid['triangles']):
                    a,b,c=[Vector(solid['vertices'][i]) for i in triangle];normal=(b-a).cross(c-a)
                    if normal.length and normal.normalized().z>.999999:selected.append(index)
                support['region']['triangles']=selected
    payload={'version':1,'frame':'pool-local-metres','fixtureModel':'pool','waterHeight':proof['model_checks']['water_z'],
        'ground':{'id':'ground:approach','bounds':[[-1.,1.,0.],[0.,2.,0.]]},'solids':solids,'rails':rails,'clips':clips,
        'revisions':{'model':digest(source),'producer':digest(Path(__file__)),
            'poseProducer':digest(BASE/'pool_activity_pose_v1.py'),'clipLibrary':hashlib.sha256(json.dumps({name:clip for name,clip in library['clips'].items() if clip['family']=='pool'},sort_keys=True,separators=(',',':')).encode()).hexdigest()},
        'coverage':{'geometry':'evaluated Blender triangles, with bevels and rail caps','waterIsSolid':False}}
    path=BASE/'clips/pool/contacts-v1.json';path.write_text(json.dumps(payload,separators=(',',':')))
    (BASE/'clips/pool/contacts-status.json').write_text(json.dumps({'state':'complete','sha256':digest(path),
        'solids':len(solids),'triangles':sum(len(s['triangles']) for s in solids),'sourceUnchanged':digest(source)==proof['model_sha256']}))

if __name__=='__main__':
    import traceback
    try:run()
    except Exception:
        (BASE/'clips/pool/contacts-status.json').write_text(json.dumps({'state':'failed','error':traceback.format_exc()}));raise
