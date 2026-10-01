"""Render independent complete dining scenes with every legal table arrangement."""
import hashlib
import json
import math
from pathlib import Path
import time
import traceback
import bpy
from array import array
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
OUT = BASE / 'seated-table'
FACINGS = {'SE': 90, 'SW': 0, 'NW': 270, 'NE': 180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    inputs = {name: digest(BASE / name) for name in
              ('render_dining_table_proof.py', 'seated-dining.blend', 'seated-dining/proof.json')}
    proof = dict(state='running', inputs=inputs, renders=[], width=256, height=192)
    journal = OUT / 'proof.json'
    if journal.exists():
        proof = json.loads(journal.read_text())
        assert proof['inputs'] == inputs
        proof['state'] = 'running'
    def save():
        checkpoints = OUT / '.checkpoints'
        checkpoints.mkdir(exist_ok=True)
        snapshot = checkpoints / f'{time.time_ns():020}.json'
        snapshot.write_text(json.dumps(proof, indent=2) + '\n')
        if proof['state'] in ('complete', 'failed'):
            journal.write_text(snapshot.read_text())
    try:
        bpy.ops.wm.open_mainfile(filepath=str(BASE / 'seated-dining.blend'))
        scene = bpy.context.scene
        rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        chair = bpy.data.objects['Seated dining chair']
        table = bpy.data.objects['Seating table clearance']
        for obj in table.children_recursive:
            obj.hide_render = False
        def basis():
            points = [world_to_camera_view(scene, scene.camera, Vector(p)) for p in
                      ((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1))]
            width, height = scene.render.resolution_x / 8, scene.render.resolution_y / 8
            return [[(p.x - points[0].x) * width, (points[0].y - p.y) * height] for p in points[1:]]
        original_basis = basis()
        assert scene.camera.data.shift_x == 0 and scene.camera.data.shift_y == 0, 'Unsupported shifted proof camera'
        # Measure every occupied arrangement through the registered camera.
        # Symmetric expansion retains the camera's physical pixel scale.
        extent_x = extent_y = 0.
        for degrees in FACINGS.values():
            angle = math.radians(degrees)
            rig.rotation_euler.z = angle - math.pi / 2
            chair.rotation_euler.z = angle
            for frame in range(8):
                scene.frame_set(frame + 1)
                for distance, table_angle, tangent in ((1.5, angle - math.pi / 2, 0),
                                                        (1., angle, -.5), (1., angle, .5)):
                    table.rotation_euler.z = table_angle
                    table.location = (-distance * math.cos(angle) - tangent * math.sin(angle),
                                      -distance * math.sin(angle) + tangent * math.cos(angle), 0)
                    bpy.context.view_layer.update()
                    deps = bpy.context.evaluated_depsgraph_get()
                    for obj in bpy.data.objects:
                        evaluated = obj.evaluated_get(deps)
                        if obj.type not in ('MESH', 'CURVE') or evaluated.hide_render:
                            continue
                        for corner in evaluated.bound_box:
                            p = world_to_camera_view(scene, scene.camera, evaluated.matrix_world @ Vector(corner))
                            extent_x = max(extent_x, abs(p.x * 80 - 40))
                            extent_y = max(extent_y, abs((1 - p.y) * 112 - 56))
        proof['width'] = math.ceil(2 * (extent_x + 8))
        proof['height'] = math.ceil(2 * (extent_y + 8))
        proof['framing'] = dict(max_x_from_optical_center=extent_x, max_y_from_optical_center=extent_y, margin=8)
        scene.camera.data.ortho_scale *= max(proof['width'], proof['height']) / 112
        scene.render.resolution_x, scene.render.resolution_y = proof['width'] * 8, proof['height'] * 8
        final_basis = basis()
        assert max(abs(a - b) for left, right in zip(original_basis, final_basis) for a, b in zip(left, right)) < .0001, 'Proof camera changed physical pixel density'
        proof['projection_basis'] = dict(original=original_basis, framed=final_basis)
        scene.render.use_freestyle = True
        bpy.context.view_layer.freestyle_settings.as_render_pass = False
        scene.use_nodes = False
        point = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof['anchor'] = [point.x * proof['width'], (1 - point.y) * proof['height'] + 21]
        existing = {(r['facing'], r['frame'], r['arrangement']) for r in proof['renders']}
        for row in proof['renders']:
            assert digest(OUT / row['path']) == row['sha256']
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            rig.rotation_euler.z = angle - math.pi / 2
            chair.rotation_euler.z = angle
            for frame in range(8):
                scene.frame_set(frame + 1)
                for arrangement, distance, table_angle, tangent in (
                        ('end', 1.5, angle - math.pi / 2, 0),
                        ('side-left', 1., angle, -.5), ('side-right', 1., angle, .5)):
                    if (facing, frame, arrangement) in existing:
                        continue
                    table.rotation_euler.z = table_angle
                    table.location = (-distance * math.cos(angle) - tangent * math.sin(angle),
                                      -distance * math.sin(angle) + tangent * math.cos(angle), 0)
                    path = OUT / f'{facing}-{frame}-{arrangement}.png'
                    scene.render.filepath = str(path)
                    bpy.ops.render.render(write_still=True)
                    image = bpy.data.images.load(str(path), check_existing=False)
                    try:
                        width, height = image.size
                        pixels = array('f', [0.]) * (width * height * 4)
                        image.pixels.foreach_get(pixels)
                        border = [(x, y) for x in range(width) for y in (0, height - 1)]
                        border.extend((x, y) for y in range(height) for x in (0, width - 1))
                        assert not any(pixels[(y * width + x) * 4 + 3] > 0 for x, y in border), 'Full-table beauty clipped'
                    finally:
                        bpy.data.images.remove(image)
                    proof['renders'].append(dict(facing=facing, frame=frame, arrangement=arrangement,
                                                 table_position=list(table.location)[:2],
                                                 table_angle=math.degrees(table_angle), path=path.name,
                                                 sha256=digest(path)))
                    save()
        assert len(proof['renders']) == 96
        assert all(digest(BASE / name) == sha for name, sha in inputs.items())
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    main()
