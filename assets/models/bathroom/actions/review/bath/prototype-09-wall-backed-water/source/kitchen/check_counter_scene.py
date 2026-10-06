"""Verify the evaluated saved models, including bevel and basin thickness."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from check_stove_scene import bounds


def touching(a,b):
    low_a,high_a = bounds(a)
    low_b,high_b = bounds(b)
    return all(max(low_a[i],low_b[i]) <= min(high_a[i],high_b[i])+1e-5 for i in range(3))


def supported_by(part, surface):
    low,high = bounds(part)
    origin = Vector(((low[0]+high[0])/2,(low[1]+high[1])/2,high[2]+.02))
    inverse = surface.matrix_world.inverted()
    hit,point,_,_ = surface.ray_cast(inverse @ origin,
                                    inverse.to_3x3() @ Vector((0,0,-1)))
    if not hit:
        return False
    height = (surface.matrix_world @ point).z
    return abs(low[2]-height) <= .01 and high[2] >= height


def check(path):
    assert bpy.app.background, 'Use a separate background Blender process'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    return {'model':str(path),**validate_scene()}


def validate_scene():
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = bpy.data.objects
    top = objects['Cream worktop'].evaluated_get(depsgraph)
    down = Vector((0,0,-1))
    for x,y in ((.44,0),(-.44,0),(0,-.44),(0,.44)):
        hit,point,_,_ = top.ray_cast(Vector((x,y,1.4)),down)
        assert hit and abs(point.z-.86)<1e-5, 'Worktop border height or support changed'
    for z in (.37,.53):
        mount = objects[f'Cabinet handle mount {z}']
        assert touching(mount,objects['Cabinet door']), 'Handle mount detached from door'
        assert touching(mount,objects['Cabinet handle']), 'Handle grip detached from mount'
    result = {'state':'passed','worktop_height':.86,
              'attached_handle_mounts':2}
    sink = objects.get('Recessed steel basin')
    if sink:
        sink = sink.evaluated_get(depsgraph)
        assert not top.ray_cast(Vector((0,-.04,1.4)),down)[0], 'Sink opening is capped'
        faucet = objects['Sink curved faucet']
        start,tip = [faucet.matrix_world @ faucet.data.splines[0].bezier_points[i].co
                     for i in (0,-1)]
        for origin in (Vector((0,-.04,1.4)),tip):
            hit,point,_,_ = sink.ray_cast(origin,down)
            assert hit and abs(point.z-.63)<1e-5, 'Sink floor or outlet drainage changed'
        assert supported_by(objects['Sink drain'],sink), 'Drain is detached from bowl floor'
        for name in ('Faucet mounting flange','Faucet lever base'):
            assert supported_by(objects[name],top), f'{name} is detached from worktop'
        low,high = bounds(objects['Faucet mounting flange'])
        assert all(low[i]<=start[i]<=high[i] for i in range(3)), 'Faucet detached from its base'
        assert touching(objects['Faucet lever'],objects['Faucet lever base']), 'Lever detached'
        result.update(sink_floor=.63,opening_clear=True,faucet_drains_into_basin=True)
    else:
        hit,point,_,_ = top.ray_cast(Vector((0,0,1.4)),down)
        assert hit and abs(point.z-.86)<1e-5, 'Plain worktop centre has a hole'
        result['central_surface_supported'] = True
    return result


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if not args or len(args)%2:
        raise ValueError('Pass saved model and new result JSON path pairs after --')
    for model,result_file in zip(args[::2],args[1::2]):
        output = Path(result_file)
        if output.exists():
            raise ValueError('Check result must use a new path')
        try:
            result = check(Path(model))
        except Exception as error:
            output.write_text(json.dumps({'state':'failed','error':str(error)},indent=2)+'\n')
            raise
        output.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
