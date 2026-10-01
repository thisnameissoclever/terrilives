"""Author a separate sitting candidate without modifying approved source files."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent.parent
LIVING = ROOT / 'assets/models/living'
SIM = ROOT / 'assets/models/sims/sim-01'
sys.path[:0] = [str(LIVING), str(SIM)]
from armchair_contact import body_inventory, evaluated_surface, intersection, seat_support
from build_rig import arm_elbow, direct_bone
from bunk_contact import point_bounds
from render_shirt_variants import material_snapshot
from rig_math import knee_point

OUTPUT = ROOT / 'output/ottoman-sit-candidate-02'
MODEL = LIVING / 'owner-review-pending/ottoman/candidate-01/ottoman-authoring.blend'
RIG = SIM / 'sim-01-rigged.blend'
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(rig):
    """Bind base geometry, weights, rest skeleton, materials and existing clips."""
    values = {'meshes': {}, 'bones': {}, 'actions': {}, 'materials': material_snapshot()}
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        values['meshes'][obj.name] = {
            'vertices': [[list(v.co), [(g.group, g.weight) for g in v.groups]] for v in obj.data.vertices],
            'faces': [list(p.vertices) for p in obj.data.polygons],
            'materials': [m.name if m else None for m in obj.data.materials],
            'groups': [g.name for g in obj.vertex_groups],
        }
    for bone in rig.data.bones:
        values['bones'][bone.name] = [list(bone.head_local), list(bone.tail_local),
                                     bone.parent.name if bone.parent else None]
    for action in bpy.data.actions:
        if action.name == 'ottoman_sit':
            continue
        values['actions'][action.name] = [[curve.data_path, curve.array_index,
            [[list(k.co), list(k.handle_left), list(k.handle_right), k.interpolation]
             for k in curve.keyframe_points]] for curve in action.fcurves]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def pose(rig, phase):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    rig['eyes_closed'] = 0.0
    rig['book_visible'] = 0.0
    bpy.context.view_layer.update()
    # The pelvis moves as an authored joint. Object and root registration stay fixed.
    offset = Vector((0, -.16, .5115 - .86))
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        direct_bone(rig, name, rest.head_local + offset, rest.tail_local + offset)
    head = rig.data.bones['head']
    tilt = Quaternion((1, 0, 0), math.radians(math.sin(phase * math.tau)))
    direct_bone(rig, 'head', head.head_local + offset,
                head.head_local + offset + tilt @ (head.tail_local - head.head_local))
    for side, sign in (('L', -1), ('R', 1)):
        hip = Vector((sign * .124, -.16, .5115))
        ankle = Vector((sign * .124, -.57, .111))
        knee_y, knee_z = knee_point((hip.y, hip.z), (ankle.y, ankle.z), .37, .36)
        knee = Vector((sign * .124, knee_y, knee_z))
        direct_bone(rig, 'thigh.' + side, hip, knee)
        direct_bone(rig, 'shin.' + side, knee, ankle)
        direct_bone(rig, 'foot.' + side, ankle, ankle + Vector((0, -.14, 0)))
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = upper.head_local + offset
        wrist = Vector((sign * .205, -.26, .6465 + .004 * math.sin(phase * math.tau)))
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length,
                          Vector((sign * .5, -.08, .66)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((-sign * .018, -.105, -.022)))


def measure(root, rig, body, frame):
    deps = bpy.context.evaluated_depsgraph_get()
    solids = {obj.name: obj for obj in root.children_recursive}
    visible = {obj.name: obj for obj in body.all_objects if not obj.hide_render}
    assert set(visible) == body_inventory(), 'Visible body inventory changed'
    assert len(solids) == 8 and all(not obj.hide_render for obj in solids.values())
    surfaces = {name: evaluated_surface(obj, deps) for name, obj in solids.items()}
    posed = {name: evaluated_surface(obj, deps) for name, obj in visible.items()}
    collisions = []
    for name, surface in posed.items():
        for other, furniture in surfaces.items():
            contact = intersection(surface, furniture)
            if contact is not None:
                collisions.append({'body': name, 'furniture': other, 'intersection': contact})
    try:
        support = {'passed': True, **seat_support(posed['Trouser hip bridge'][0], solids['Cushion'], deps)}
    except (AssertionError, ValueError) as error:
        support = {'passed': False, 'reason': str(error)}
    soles = {name: point_bounds(posed[name][0])[0][2] for name in
             ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001')}
    bone_errors = {bone.name: abs(bone.length - rig.data.bones[bone.name].length)
                   for bone in rig.pose.bones}
    assert max(bone_errors.values()) < 1e-5, 'Pose stretched a bone'
    assert rig.location.length < 1e-6 and root.location.length < 1e-6
    assert (rig.pose.bones['root'].matrix - rig.data.bones['root'].matrix_local).to_translation().length < 1e-6
    return {'frame': frame, 'collisions': collisions, 'hip_support': support,
            'sole_min_z': soles, 'maximum_bone_length_error': max(bone_errors.values()),
            'passed': not collisions and support['passed'] and all(0 <= z <= .001 for z in soles.values())}


def main():
    assert bpy.app.background, 'Background authoring only'
    OUTPUT.mkdir(exist_ok=False)
    inputs = (MODEL, RIG, Path(__file__), LIVING/'armchair_contact.py',
              LIVING/'armchair_support.py', SIM/'build_rig.py', SIM/'rig_math.py',
              SIM/'render_shirt_variants.py')
    signature = {str(p.relative_to(ROOT)): digest(p) for p in inputs}
    proof = {'state': 'running', 'pid': os.getpid(), 'background': bpy.app.background,
             'blender_version': bpy.app.version_string, 'source_hashes': signature,
             'scope': 'Offline additive sitting candidate; no runtime acceptance', 'renders': []}
    status = OUTPUT / 'status.json'

    def save():
        status.write_text(json.dumps(proof, indent=2) + '\n')

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(MODEL))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root = bpy.data.objects['OTTOMAN_MODEL_ROOT']
        body = bpy.data.collections['Preserved Sim reference - hidden']
        body.hide_render = False
        root.rotation_euler.z = 0
        rig.rotation_euler.z = -math.pi / 2
        before = fingerprint(rig)
        assert 'ottoman_sit' not in bpy.data.actions
        action = bpy.data.actions.new('ottoman_sit')
        action.use_fake_user = True
        action['loop_samples'] = 4
        action['sample_fps'] = 2
        rig.animation_data.action = action
        for index in range(5):
            pose(rig, (index % 4) / 4)
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                for channel in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(channel, frame=index + 1)
            for prop in ('eyes_closed', 'book_visible'):
                rig.keyframe_insert(data_path=f'["{prop}"]', frame=index + 1)
        assert fingerprint(rig) == before, 'Approved geometry or existing actions changed'
        proof['preserved_scene_fingerprint'] = before
        scene.frame_set(1)
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        candidate = OUTPUT/'ottoman-sit-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(candidate))
        bpy.ops.wm.open_mainfile(filepath=str(candidate))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root = bpy.data.objects['OTTOMAN_MODEL_ROOT']
        body = bpy.data.collections['Preserved Sim reference - hidden']
        assert fingerprint(rig) == before, 'Saved scene changed approved data'
        proof['candidate_sha256'] = digest(candidate)
        proof['samples'] = []
        for frame in range(1, 5):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            proof['samples'].append(measure(root, rig, body, frame))
            save()
        proof['fit_passed'] = all(row['passed'] for row in proof['samples'])
        for facing, degrees in FACINGS.items():
            scene.frame_set(1)
            root.rotation_euler.z = math.radians(degrees)
            rig.rotation_euler.z = math.radians(degrees - 90)
            bpy.context.view_layer.update()
            path = OUTPUT/f'ottoman-sit-{facing}.png'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            proof['renders'].append({'path': path.name, 'facing': facing, 'sha256': digest(path)})
            save()
        assert all(digest(ROOT/name) == expected for name, expected in signature.items())
        proof.update(state='complete', source_bytes_unchanged=True)
        save()
    except Exception:
        proof.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    main()
