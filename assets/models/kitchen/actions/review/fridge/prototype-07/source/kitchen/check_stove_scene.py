"""Check attachments in a saved stove scene, independently of its source script."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return tuple(min(p[axis] for p in points) for axis in range(3)), tuple(
        max(p[axis] for p in points) for axis in range(3))


def check(path):
    assert bpy.app.background, 'Use a separate background Blender process'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.context.view_layer.update()
    errors = []
    wells = [obj for obj in bpy.data.objects if obj.name.startswith('Burner well ')]
    coils = [obj for obj in bpy.data.objects if obj.name.startswith('Burner coil ')]
    assert len(wells) == 4 and len(coils) == 12, 'Four three-ring burners required'
    for coil in coils:
        well = min(wells,key=lambda obj: (obj.location.xy-coil.location.xy).length)
        if (well.location.xy-coil.location.xy).length > 1e-5:
            errors.append(f'{coil.name}: not centred on a burner well')
        if bounds(coil)[0][2] > bounds(well)[1][2]+1e-5:
            errors.append(f'{coil.name}: floats above its supporting well')
    for x in (-.30,-.10,.10,.30):
        knob = bpy.data.objects[f'Range control {x}']
        indicator = bpy.data.objects[f'Range control indicator {x}']
        if bounds(indicator)[1][1] < bounds(knob)[0][1]-1e-5:
            errors.append(f'{indicator.name}: floats in front of knob')
        if bounds(indicator)[0][1] >= bounds(knob)[0][1]:
            errors.append(f'{indicator.name}: hidden inside knob')
    hinge = bpy.data.objects['Oven bottom hinge']
    for name in ('Oven door','Oven door gasket','Oven window trim','Oven window glass',
                 'Oven handle','Oven handle mount -0.29','Oven handle mount 0.29'):
        if bpy.data.objects[name].parent != hinge:
            errors.append(f'{name}: does not follow the oven hinge')
    assert not errors, '\n'.join(errors)
    return {'state':'passed','model':str(path),'burner_wells':len(wells),
            'supported_coils':len(coils),'attached_indicators':4,'hinged_door_parts':7}


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 2:
        raise ValueError('Pass the saved stove blend and a new result JSON path after --')
    output = Path(arguments[1])
    if output.exists():
        raise ValueError('Check result must use a new path')
    try:
        result = check(Path(arguments[0]))
    except Exception as error:
        output.write_text(json.dumps({'state':'failed','error':str(error)},indent=2)+'\n')
        raise
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
