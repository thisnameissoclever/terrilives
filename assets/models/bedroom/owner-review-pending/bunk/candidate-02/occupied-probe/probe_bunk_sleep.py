"""Measure and render an occupied pilot without editing the approved Sim file."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent/'kitchen')]
from check_stove_scene import bounds

TRANSLATION = (0, -.50151527, 0)


def vertices(obj, deps):
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ point.co for point in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def vertical_gaps(points, surface, deps):
    evaluated = surface.evaluated_get(deps)
    inverse = evaluated.matrix_world.inverted()
    gaps = []
    for point in points:
        hit, position, _, _ = evaluated.ray_cast(inverse @ Vector((point.x, point.y, 3)),
                                               inverse.to_3x3() @ Vector((0, 0, -1)))
        if hit:
            gaps.append(point.z-(evaluated.matrix_world @ position).z)
    assert gaps, f'No supported samples above {surface.name}'
    return min(gaps)


def run(model, output):
    assert bpy.app.background
    output.mkdir(parents=True, exist_ok=False)
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    result = {'state': 'running', 'model_sha256': before,
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'canonical_translation': TRANSLATION, 'samples': [],
              'acceptance': 'Unreviewed contact probe, not production artwork'}
    def save():
        (output/'proof.json').write_text(json.dumps(result, indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root = bpy.data.objects['BUNK_MODEL_ROOT']
        collection = bpy.data.collections['Preserved Sim reference - hidden']
        collection.hide_render = False
        rig.animation_data.action = bpy.data.actions['sleep']
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        rig.location = TRANSLATION
        for frame in range(1, 5):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            visible = [obj for obj in collection.objects
                       if obj.type == 'MESH' and not obj.hide_render]
            deps = bpy.context.evaluated_depsgraph_get()
            points = {obj.name: vertices(obj, deps) for obj in visible}
            measured = {name: [[min(v[i] for v in mesh) for i in range(3)],
                               [max(v[i] for v in mesh) for i in range(3)]]
                        for name, mesh in points.items()}
            low = [min(pair[0][i] for pair in measured.values()) for i in range(3)]
            high = [max(pair[1][i] for pair in measured.values()) for i in range(3)]
            wood = [obj for obj in root.children
                    if obj.data.materials and obj.data.materials[0].name == 'Bunk warm oak']
            overlap_candidates = []
            for name, (body_low, body_high) in measured.items():
                for obj in wood:
                    wood_low, wood_high = bounds(obj.evaluated_get(deps))
                    if all(body_low[i] < wood_high[i] and wood_low[i] < body_high[i]
                           for i in range(3)):
                        overlap_candidates.append([name, obj.name])
            # Disjoint evaluated bounds prove these solids cannot intersect.
            # An overlap would require a finer mesh test, not automatic acceptance.
            assert not overlap_candidates, f'Body/frame overlap needs inspection: {overlap_candidates}'
            assert low[1] >= -.90 and high[1] <= .90, 'Sleeper leaves mattress length'
            mattress = bpy.data.objects['Lower mattress']
            gaps = {name: vertical_gaps(points[name], mattress, deps)
                    for name in ('Overshirt body', 'Fitted rounded shoe sole',
                                 'Fitted rounded shoe sole.001')}
            head_points = [v for name in ('Sculpted head', 'HAIR_01_TRIPO_CURL')
                           for v in points[name] if .02 < abs(v.x) < .25 and .66 < v.y < .80]
            gaps['head_to_pillow'] = vertical_gaps(head_points, bpy.data.objects['Lower pillow'], deps)
            assert all(-.025 <= gap <= .01 for gap in gaps.values()), f'Lost bedding support: {gaps}'
            result['samples'].append({'frame':frame, 'bounds':[low, high], 'parts':measured,
                                      'body_frame_overlap_candidates': overlap_candidates,
                                      'support_gaps': gaps})
        # Pilot includes the full physical scene so bedding intersections
        # remain visible rather than being hidden by an arbitrary 2D layer.
        scene.frame_set(1)
        root.rotation_euler.z = math.pi/2
        rig.rotation_euler.z = math.pi/2
        rig.location = root.rotation_euler.to_matrix() @ Vector(TRANSLATION)
        bpy.context.view_layer.update()
        scene.render.filepath = str(output/'sleep-SE-0-beauty.png')
        bpy.ops.render.render(write_still=True)
        result['render_sha256'] = hashlib.sha256(Path(scene.render.filepath).read_bytes()).hexdigest()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == before
        result['state'] = 'complete'
        save()
    except Exception:
        result.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass saved bunk scene and a new probe directory')
    run(*map(Path, args))
