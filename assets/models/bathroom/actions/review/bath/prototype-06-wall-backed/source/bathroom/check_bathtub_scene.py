"""Check the saved tub's cavity, footprint and sampled attachment contacts."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE),str(BASE.parent/'kitchen')]
from check_counter_scene import supported_by
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from check_shower_scene import contains


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    objects = bpy.data.objects
    shell = objects['Bathtub continuous shell'].evaluated_get(deps)
    down = Vector((0,0,-1))
    hit,floor,_,_ = shell.ray_cast(Vector((0,0,1.5)),down)
    assert hit and abs(floor.z-.15)<1e-5, 'Tub cavity floor changed'
    low,high = bounds(shell)
    # The evaluated bevel can remove at most its 8 mm width from an extreme.
    # It cannot enlarge the shell beyond the authored footprint envelope.
    assert -.41001<=low[0]<=-.402 and .402<=high[0]<=.41001, 'Tub width changed'
    assert -.92001<=low[1]<=-.912 and .912<=high[1]<=.92001, 'Tub longitudinal placement changed'
    assert abs(high[2]-.57)<.001, 'Tub rim height changed'
    plinth = objects['Bathtub inset plinth']
    assert abs(bounds(plinth)[0][2])<1e-5, 'Tub plinth floats'
    assert supported_by(objects['Bathtub drain'],shell), 'Drain lost floor support'
    for name in ('Bathtub tap foot','Bathtub tap base -0.135','Bathtub tap base 0.135'):
        assert supported_by(objects[name],shell), f'{name} lost deck support'
    contacts = {}
    pairs = [('Bathtub inset plinth','Bathtub continuous shell'),
             ('Bathtub overflow','Bathtub continuous shell')]
    for x in (-.135,.135):
        pairs += [(f'Bathtub tap stem {x}',f'Bathtub tap base {x}'),
                  (f'Bathtub tap handle {x}',f'Bathtub tap stem {x}')]
    for first,second in pairs:
        witness = overlap_witness(objects[first],objects[second],deps)
        assert witness, f'{first} detached from {second}'
        contacts[first+' / '+second] = witness
    spout = objects['Bathtub curved spout']
    start,tip = [spout.matrix_world @ spout.data.splines[0].bezier_points[i].co for i in (0,-1)]
    assert contains(objects['Bathtub tap foot'].evaluated_get(deps),start), 'Spout detached from foot'
    hit,point,_,_ = shell.ray_cast(tip,down)
    assert hit and .149<point.z<.40, 'Spout misses recessed basin'
    return {'state':'passed','floor_z':floor.z,'shell_bounds':[low,high],
            'authored_SE_occupied_bounds_relative_to_render_row':[[-1,1],[-.5,.5]],
            'spout_hit_z':point.z,'contact_witnesses':contacts}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args)!=2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new JSON path')
    model,output = map(Path,args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    mutations = []
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        for name,axis,amount,expected in (
            ('Bathtub drain','z',.1,'Drain lost floor support'),
            ('Bathtub tap foot','z',.1,'Bathtub tap foot lost deck support'),
            ('Bathtub overflow','y',-.15,'Bathtub overflow detached from Bathtub continuous shell'),
            ('Bathtub inset plinth','z',.1,'Tub plinth floats'),
            ('Bathtub tap handle -0.135','x',.2,'Bathtub tap handle -0.135 detached from Bathtub tap stem -0.135'),
            ('Bathtub curved spout','x',.5,'Spout detached from foot'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location,axis,getattr(obj.location,axis)+amount)
            try:
                validate()
            except AssertionError as error:
                assert str(error)==expected, f'Unrelated failure: {error}'
                mutations.append({'part':name,'caught':expected})
            else:
                raise AssertionError(f'Corruption survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest()==original, 'Saved model changed'
        result.update(model_sha256=original,mutations=mutations)
        output.write_text(json.dumps(result,indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state':'failed','error':str(error),'completed':mutations},indent=2)+'\n')
        raise
