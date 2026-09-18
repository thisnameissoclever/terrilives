"""Read the saved sink's support surfaces; corrupt copies only in memory."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0,str(BASE.parent/'kitchen'))
from check_counter_scene import supported_by, touching
from check_stove_scene import bounds


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    objects = bpy.data.objects
    bowl = objects['Bathroom ceramic basin'].evaluated_get(deps)
    down = Vector((0,0,-1))
    hit,point,_,_ = bowl.ray_cast(Vector((0,-.055,1.4)),down)
    assert hit and abs(point.z-.655)<1e-5, 'Basin floor is not recessed'
    floor_height = point.z
    assert supported_by(objects['Bathroom drain'],bowl), 'Drain lost floor support'
    assert supported_by(objects['Bathroom faucet flange'],bowl), 'Faucet lost deck support'
    faucet = objects['Bathroom faucet']
    start,tip = [faucet.matrix_world @ faucet.data.splines[0].bezier_points[i].co
                 for i in (0,-1)]
    hit,point,_,_ = bowl.ray_cast(tip,down)
    assert hit and abs(point.z-.655)<1e-5, 'Faucet misses the bowl'
    low,high = bounds(objects['Bathroom faucet flange'])
    assert all(low[i]<=start[i]<=high[i] for i in range(3)), 'Faucet detached from flange'
    low,high = bounds(objects['Bathroom ceramic pedestal'])
    origin = Vector(((low[0]+high[0])/2,(low[1]+high[1])/2,high[2]-.1))
    hit,point,_,_ = bowl.ray_cast(origin,Vector((0,0,1)))
    assert hit and 0<=high[2]-point.z<.03, 'Pedestal does not support bowl'
    assert abs(low[2])<1e-5, 'Pedestal does not meet floor'
    assert touching(objects['Bathroom lever hinge'],objects['Bathroom tap lever']), 'Lever detached'
    return {'state':'passed','recessed_floor':floor_height,
            'drain_supported':True,'faucet_supported':True,'pedestal_supported':True}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args)!=2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new JSON path')
    model,output = map(Path,args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    results = []
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        clean = validate()
        for name,axis,amount,error in (
            ('Bathroom drain','z',.1,'Drain lost floor support'),
            ('Bathroom faucet flange','z',.1,'Faucet lost deck support'),
            ('Bathroom faucet','x',.6,'Faucet misses the bowl'),
            ('Bathroom ceramic pedestal','x',.6,'Pedestal does not support bowl'),
            ('Bathroom tap lever','x',.3,'Lever detached'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location,axis,getattr(obj.location,axis)+amount)
            try:
                validate()
            except AssertionError as failure:
                assert str(failure)==error, f'{name}: unrelated failure: {failure}'
                results.append({'part':name,'caught':error})
            else:
                raise AssertionError(f'Corruption survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest()==original, 'Saved model changed'
        output.write_text(json.dumps({'state':'passed','clean':clean,
                                     'mutations':results,'model_sha256':original},indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state':'failed','error':str(error),
                                     'completed':results},indent=2)+'\n')
        raise
