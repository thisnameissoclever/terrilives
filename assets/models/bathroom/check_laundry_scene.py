"""Verify closed laundry fittings and distinct control areas in a saved scene."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen')]
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    objects = bpy.data.objects
    deps = bpy.context.evaluated_depsgraph_get()
    controls = ['Washer detergent drawer', 'Washer dial', 'Washer indicator']
    clearances = []
    for left, right in zip(controls, controls[1:]):
        clearance = bounds(objects[right])[0][0]-bounds(objects[left])[1][0]
        assert clearance > .01, 'Washer controls overlap'
        clearances.append(clearance)
    contacts = {}

    def contact(first, second):
        witness = overlap_witness(objects[first], objects[second], deps)
        assert witness, f'{first} detached from {second}'
        contacts[first+' / '+second] = witness

    feet = [obj for obj in objects if obj.name.startswith('Laundry foot ')]
    assert len(feet) == 4, 'Four levelling feet required'
    for foot in feet:
        assert abs(bounds(foot)[0][2]) < 1e-5, 'Foot lost floor contact'
        contact(foot.name, 'Washer case')
    contact('Laundry stacking tray', 'Washer case')
    contact('Laundry stacking tray', 'Dryer case')
    for label in ('Washer', 'Dryer'):
        for part, support in (
            ('front panel', 'case'), ('door seal', 'front panel'),
            ('door rim', 'door seal'), ('dark window', 'door seal'),
            ('door grip', 'door rim'), ('hinge cover', 'door seal'),
            ('control strip', 'front panel'), ('indicator', 'control strip'),
            ('dial', 'control strip'), ('dial marker', 'dial'),
            ('rear service panel', 'case'),
        ):
            contact(label+' '+part, label+' '+support)
        rim = objects[label+' door rim'].evaluated_get(deps)
        window = objects[label+' dark window']
        origin = window.matrix_world.translation.copy()
        origin.y = -1
        inverse = rim.matrix_world.inverted()
        hit = rim.ray_cast(inverse @ origin, inverse.to_3x3() @ Vector((0, 1, 0)))[0]
        assert not hit, 'Door rim blocks the window center'
    contact('Washer detergent drawer', 'Washer control strip')
    for x in (-.14, .14):
        contact(f'Washer rear connector {x}', 'Washer rear service panel')
    for z in (1.05, 1.09, 1.13):
        contact(f'Dryer rear vent {z}', 'Dryer rear service panel')
    return {'state': 'passed', 'control_clearances_m': clearances,
            'contact_witnesses': contacts, 'floor_contacts': 4,
            'door_rim_centers_open': True}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new JSON path')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    mutations = []
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        for name, axis, amount, expected in (
            ('Washer detergent drawer', 'x', .25, 'Washer controls overlap'),
            ('Laundry foot -0.29 -0.28', 'z', .1, 'Foot lost floor contact'),
            ('Dryer case', 'z', .1, 'Laundry stacking tray detached from Dryer case'),
            ('Washer door grip', 'y', -.1, 'Washer door grip detached from Washer door rim'),
            ('Dryer dark window', 'y', -.1, 'Dryer dark window detached from Dryer door seal'),
            ('Dryer dial', 'y', -.1, 'Dryer dial detached from Dryer control strip'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate()
            except AssertionError as failure:
                assert str(failure) == expected, f'Unrelated failure: {failure}'
                mutations.append({'part': name, 'caught': expected})
            else:
                raise AssertionError(f'Corruption survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original, 'Saved model changed'
        result.update(model_sha256=original, mutations=mutations)
        output.write_text(json.dumps(result, indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error),
                                     'completed': mutations}, indent=2)+'\n')
        raise
