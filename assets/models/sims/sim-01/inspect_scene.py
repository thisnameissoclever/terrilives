import bpy, json, traceback
from pathlib import Path
from mathutils import Vector
BASE = Path(__file__).resolve().parent
try:
    assert bpy.app.background
    (BASE/'inspection-status.json').write_text(json.dumps({'state':'running'}))
    bpy.ops.wm.open_mainfile(filepath=str(BASE / 'source/approved-neutral.blend'))
    result = {'objects': [], 'render': {}}
    for obj in bpy.data.objects:
        entry = {'name': obj.name, 'type': obj.type, 'parent': obj.parent.name if obj.parent else None,
                 'location': list(obj.location), 'scale': list(obj.scale), 'rotation': list(obj.rotation_euler),
                 'hidden': obj.hide_render}
        if obj.type in ('MESH', 'CURVE'):
            entry['modifiers'] = [{'name': m.name, 'type':m.type} for m in obj.modifiers]
            corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            entry['bounds'] = [[min(c[i] for c in corners) for i in range(3)], [max(c[i] for c in corners) for i in range(3)]]
            entry['materials'] = [m.name for m in obj.data.materials]
            if obj.type == 'MESH': entry['vertices'] = len(obj.data.vertices)
        if obj.type == 'CAMERA': entry['ortho_scale'] = obj.data.ortho_scale
        result['objects'].append(entry)
    scene = bpy.context.scene
    result['render'] = {'x': scene.render.resolution_x, 'y': scene.render.resolution_y, 'percentage': scene.render.resolution_percentage, 'engine':scene.render.engine, 'camera':scene.camera.name}
    (BASE / 'scene-inspection.json').write_text(json.dumps(result, indent=2))
    (BASE/'inspection-status.json').write_text(json.dumps({'state':'complete'}))
except Exception:
    (BASE / 'inspection-error.txt').write_text(traceback.format_exc())
    (BASE/'inspection-status.json').write_text(json.dumps({'state':'failed','traceback':traceback.format_exc()}))
    raise
