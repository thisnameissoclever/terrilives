"""Derive registered surface depth from the unchanged source fixtures and color coverage."""
from pathlib import Path
import json,hashlib,math,tomllib,traceback
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parents[4];OUT=Path(__file__).parent/'fixture-depth';OUT.mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
SOURCES={
 'offlineCounter':'kitchen/owner-review-pending/counter/candidate-01',
 'offlineSink':'kitchen/owner-review-pending/kitchen-sink/candidate-01',
 'offlineStove':'kitchen/owner-review-pending/stove/candidate-02',
 'offlineDiningTable':'dining/owner-review-pending/dining-table/candidate-01',
}
atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text());rows={row['name']:(i,row) for i,row in enumerate(atlas['sprite'])}
report={'version':1,'state':'running','sprites':[],'sources':{},'coverageSources':{},'producerSha256':sha(Path(__file__)),'width':2048,'originY':1024}
def save(): (OUT/'manifest.json').write_text(json.dumps(report,indent=2))
canvas=np.zeros((1024,2048,4),dtype=np.uint8);cursor_x=0;cursor_y=0;row_height=0
try:
 for prefix,relative in SOURCES.items():
  directory=ROOT/'assets/models'/relative;proof=json.loads((directory/'proof.json').read_text());models=list(directory.glob('*.blend'));assert len(models)==1
  source=models[0];before=sha(source);assert before==proof['model_sha256'];report['sources'][prefix]={'path':source.relative_to(ROOT).as_posix(),'sha256':before}
  bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
  scene=bpy.context.scene;camera=scene.camera;root=next(o for o in bpy.data.objects if o.type=='EMPTY' and o.name.endswith('_MODEL_ROOT'))
  for facing,degrees in [('SE',90),('NW',270),('SW',0),('NE',180)]:
   name=prefix+('' if facing=='SE' else facing);index,sprite=rows[name];w,h=sprite['w'],sprite['h'];root.rotation_euler.z=math.radians(degrees);bpy.context.view_layer.update()
   dep=bpy.context.evaluated_depsgraph_get();vertices=[];triangles=[]
   for obj in root.children_recursive:
    if obj.type not in ('MESH','CURVE') or obj.hide_render:continue
    evaluated=obj.evaluated_get(dep);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();start=len(vertices)
    vertices.extend([evaluated.matrix_world@v.co for v in mesh.vertices]);triangles.extend([tuple(start+i for i in tri.vertices) for tri in mesh.loop_triangles]);evaluated.to_mesh_clear()
   assert vertices and triangles;tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
   frame=camera.data.view_frame(scene=scene);left,right=min(v.x for v in frame),max(v.x for v in frame);bottom,top=min(v.y for v in frame),max(v.y for v in frame)
   direction=camera.matrix_world.to_quaternion()@Vector((0,0,-1));values=np.full((h,w),np.nan,dtype=np.float64)
   for y in range(h):
    for x in range(w):
     origin=camera.matrix_world@Vector((left+(x+.5)/w*(right-left),top-(y+.5)/h*(top-bottom),0))
     hit=tree.ray_cast(origin,direction)[0]
     if hit is not None:values[y,x]=hit.x-hit.y
   page=atlas['pages'][sprite.get('page',0)];page=page if isinstance(page,str) else page['image']
   image_path=ROOT/'assets/sprites'/page
   if not image_path.exists(): image_path=ROOT/'web/public'/page
   coverage_key=image_path.relative_to(ROOT).as_posix();coverage_hash=sha(image_path);assert report['coverageSources'].get(coverage_key,coverage_hash)==coverage_hash;report['coverageSources'][coverage_key]=coverage_hash
   image=bpy.data.images.load(str(image_path),check_existing=False);pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32);image.pixels.foreach_get(pixels)
   alpha=np.flipud(pixels.reshape((image.size[1],image.size[0],4)))[sprite['y']:sprite['y']+h,sprite['x']:sprite['x']+w,3]>=.5;bpy.data.images.remove(image)
   projected=[]
   for v in vertices:
    p=world_to_camera_view(scene,camera,v);projected.append([p.x*w,(1-p.y)*h,v.x-v.y])
   projected=np.asarray(projected);edges=np.asarray([(a,b) for tri in triangles for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]])
   a=projected[edges[:,0]];b=projected[edges[:,1]];delta=b[:,:2]-a[:,:2];length=np.sum(delta*delta,axis=1);max_outline_distance=0;outline=0
   for y,x in zip(*np.where(alpha&np.isnan(values))):
    point=np.array([x+.5,y+.5]);t=np.clip(np.sum((point-a[:,:2])*delta,axis=1)/np.maximum(length,1e-20),0,1);distance=np.sum((a[:,:2]+delta*t[:,None]-point)**2,axis=1);best=np.min(distance)
    nearest=np.where(distance<=best+1e-9)[0];values[y,x]=max(a[i,2]+t[i]*(b[i,2]-a[i,2]) for i in nearest);max_outline_distance=max(max_outline_distance,float(math.sqrt(best)));outline+=1
   assert max_outline_distance<=math.sqrt(.5)+1e-5,(name,'color coverage is not registered to the source mesh',max_outline_distance)
   valid=values[alpha];assert len(valid)>0 and np.isfinite(valid).all() and valid.min()>=-2 and valid.max()<=2
   encoded=np.rint((np.nan_to_num(values)+2)/4*65535).astype(np.uint16);rgba=np.zeros((h,w,4),dtype=np.uint8);rgba[:,:,0]=encoded>>8;rgba[:,:,1]=encoded&255;rgba[:,:,3]=255
   if cursor_x+w>2048:cursor_x=0;cursor_y+=row_height;row_height=0
   assert cursor_y+h<=1024
   canvas[cursor_y:cursor_y+h,cursor_x:cursor_x+w]=rgba
   report['sprites'].append({'name':name,'sprite':index,'x':cursor_x,'y':cursor_y+1024,'w':w,'h':h,'pixelDensity':sprite.get('pixel_density',1),'facing':facing,'opaquePixels':int(alpha.sum()),'outlineSamples':outline,'maxOutlineDistancePixels':max_outline_distance,'minSum':float(valid.min()),'maxSum':float(valid.max())})
   cursor_x+=w;row_height=max(row_height,h);save();print(name,'depth complete',flush=True)
  assert sha(source)==before
 report['height']=cursor_y+row_height;data=canvas[:report['height']].tobytes();(OUT/'surface-depth.rgba').write_bytes(data);report['sha256']=hashlib.sha256(data).hexdigest();report['state']='complete';save()
except Exception:
 report['state']='failed';report['error']=traceback.format_exc();save();raise
