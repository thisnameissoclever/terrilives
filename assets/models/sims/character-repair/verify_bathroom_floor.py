"""Replay bathroom companion depth against the physical floor on each camera ray."""
from pathlib import Path
import json
import math
import sys
import tomllib
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[3]
sys.path.insert(0,str(BASE))
from depth_geometry import geometry,digest
from export_components import image_bytes

manifest=json.loads((BASE/'fixture-depth/manifest.json').read_text())
atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
pages=[np.frombuffer((BASE/'fixture-depth'/row['path']).read_bytes(),dtype=np.uint8).reshape((2048,2048,4)) for row in manifest['pages']]
records=[]
for prefix in ['offlineToilet','offlineBathtub','offlineCounter']:
    source=ROOT/manifest['sources'][prefix]['path']
    assert digest(source)==manifest['sources'][prefix]['sha256']
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    root=next(obj for obj in bpy.data.objects if obj.type=='EMPTY' and obj.name.endswith('_MODEL_ROOT'))
    scene,camera=bpy.context.scene,bpy.context.scene.camera
    for facing,degrees in {'SE':90,'NW':270,'SW':0,'NE':180}.items():
        row=next(row for row in manifest['sprites'] if row['source']==prefix and row['facing']==facing)
        sprite=atlas['sprite'][row['atlasIndex']]
        root.rotation_euler.z=math.radians(degrees)
        for obj in root.children_recursive:obj.hide_render=False
        bpy.context.view_layer.update()
        vertices,triangles,_=geometry(root.children_recursive)
        tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
        rgba=image_bytes('crop',ROOT/'web/public'/atlas['pages'][sprite.get('page',0)],BASE/'floor-witness-pixels.rgba',
                         [sprite['x'],sprite['y'],sprite['w'],sprite['h']])
        depth=pages[row['pageIndex']][row['y']:row['y']+row['h'],row['x']:row['x']+row['w']]
        decoded=(depth[:,:,0].astype(np.uint16)*256+depth[:,:,1])/65535*4-2
        frame=camera.data.view_frame(scene=scene)
        left,right=min(v.x for v in frame),max(v.x for v in frame)
        bottom,top=min(v.y for v in frame),max(v.y for v in frame)
        direction=camera.matrix_world.to_quaternion()@Vector((0,0,-1))
        errors,clearances,zs=[],[],[]
        for y,x in zip(*np.where(rgba[:,:,3]>=128)):
            origin=camera.matrix_world@Vector((left+(x+.5)/row['w']*(right-left),top-(y+.5)/row['h']*(top-bottom),0))
            hit=tree.ray_cast(origin,direction)[0]
            if hit is None:continue
            floor=origin+direction*(-origin.z/direction.z)
            errors.append(abs(decoded[y,x]-(hit.x-hit.y)))
            clearances.append(decoded[y,x]-(floor.x-floor.y))
            zs.append(hit.z)
        assert max(errors)<=4/65535
        assert min(clearances)>=-4/65535
        records.append(dict(name=row['name'],raySamples=len(errors),minimumSourceVertexZ=min(v.z for v in vertices),
            minimumVisibleZ=min(zs),maximumVisibleZ=max(zs),maximumDecodedDepthError=max(errors),
            minimumNearerThanFloor=min(clearances),maximumNearerThanFloor=max(clearances),
            canvas=[row['w'],row['h']],sourceCamera=[list(v) for v in camera.matrix_world]))
        print(row['name'],records[-1]['minimumNearerThanFloor'],max(errors),flush=True)
(BASE/'bathroom-floor-verification.json').write_text(json.dumps(dict(state='complete',records=records),indent=2),encoding='utf-8')
