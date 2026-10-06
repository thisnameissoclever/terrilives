"""Create a checked central toilet candidate with actual curved support."""
import json
import math
from pathlib import Path
import shutil
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_toilet_use import SOURCE, MODELS, FACINGS, digest, partition, validate_fixture
from toilet_pose import apply
from toilet_leg_plan import leg_plan
from toilet_hand_plan import vertical_hand_lift
from toilet_pose_geometry import two_link
from toilet_contact import measure
from build_rig import direct_bone
from armchair_contact import evaluated_surface
from toilet_leg_probe import curved_support, capture
from animation_export import render_pass


def canvas_margin(scene, collections):
    deps = bpy.context.evaluated_depsgraph_get()
    projected = []
    for collection in collections:
        for obj in collection.all_objects:
            if obj.hide_render or obj.type not in ('MESH', 'CURVE'):
                continue
            evaluated = obj.evaluated_get(deps)
            mesh = evaluated.to_mesh()
            try:
                projected.extend(world_to_camera_view(scene, scene.camera, evaluated.matrix_world@v.co)
                                 for v in mesh.vertices)
            finally:
                evaluated.to_mesh_clear()
    margin = min(min(p.x for p in projected)*768, min(p.y for p in projected)*960,
                 (1-max(p.x for p in projected))*768, (1-max(p.y for p in projected))*960)
    if not math.isfinite(margin) or margin < 8:
        raise ValueError('Complete candidate geometry lacks source canvas margin')
    return margin


def fit_hands(rig, body):
    deps = bpy.context.evaluated_depsgraph_get()
    clothing = {name:evaluated_surface(body.objects[name], deps) for name in
                ('Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001')}
    results = {}
    for side, sign, suffix in (('L', -1, ''), ('R', 1, '.001')):
        gaps = []
        for name in ('Relaxed palm'+suffix, 'Resting thumb'+suffix):
            for point in evaluated_surface(body.objects[name], deps)[0]:
                hits = [surface[1].ray_cast(Vector((point.x, point.y, 2)), Vector((0, 0, -1)), 4)[0]
                        for surface in clothing.values()]
                heights = [hit.z for hit in hits if hit is not None]
                if heights:
                    gaps.append(point.z-max(heights))
        lift = vertical_hand_lift(gaps)
        hand = rig.pose.bones['hand.'+side]
        wrist, tail = hand.head.copy()+Vector((0, 0, lift)), hand.tail.copy()+Vector((0, 0, lift))
        shoulder = rig.pose.bones['upper_arm.'+side].head.copy()
        elbow = Vector(two_link(shoulder, wrist, rig.data.bones['upper_arm.'+side].length,
                                rig.data.bones['forearm.'+side].length, (sign*.5, -.05, wrist.z)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direct_bone(rig, 'hand.'+side, wrist, tail)
        results[side] = dict(measured_min_before=min(gaps), whole_hand_lift=lift,
                             desired_nearest_gap=.001, sampled_vertices=len(gaps))
    return results


def require_candidate(metrics, support, root, rig):
    failures = []
    if metrics['collisions']:
        failures.append('body/fixture collisions')
    if any(row['intersection'] for row in metrics['hand_clothing_proximity']):
        failures.append('hand/clothing collisions')
    if support['state'] != 'passed' or not 0 <= metrics['ring_min_gap'] <= .003:
        failures.append('continuous curved hip support')
    if metrics['complete_body_solid_pairs'] != 756 or len(metrics['bone_length_errors']) != 17:
        failures.append('complete body/fixture/bone inventory')
    if max(metrics['bone_length_errors'].values()) > 1e-5:
        failures.append('anatomical bone lengths')
    if any(not .018 <= row['min_z'] <= .020 for row in metrics['soles'].values()):
        failures.append('inherited sole clearance')
    if any(abs(v-1) > 1e-6 for obj in (root, rig) for v in obj.scale):
        failures.append('body/fixture scale')
    if failures:
        raise ValueError('Toilet candidate fails: '+', '.join(failures))


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    prior_path, contact_path = [BASE/'review/toilet'/name/'proof.json' for name in
                                ('prototype-07-diagnostics', 'contact-facets-01')]
    prior, contact = [json.loads(path.read_text()) for path in (prior_path, contact_path)]
    proposal = contact['cases'][0]
    inputs = dict(prior['inputs'])
    scripts = {Path(module.__file__).resolve() for module in sys.modules.values()
               if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
               and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    scripts.update((Path(__file__), prior_path, contact_path))
    inputs.update({p.relative_to(MODELS).as_posix():digest(p) for p in scripts})
    for name, sha in inputs.items():
        path = MODELS/name
        if digest(path) != sha:
            raise ValueError('Source dependency changed')
        if path.suffix == '.py':
            target = output/'source'/name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    proof = dict(state='running', mode='central-candidate-curved-support-source-review', inputs=inputs,
                 source_accepted=False, renders=[])
    def save():
        (output/'proof.json').write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        scene = bpy.context.scene
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = rig.rotation_euler.z = 0
        rig.animation_data.action = None
        scene.frame_set(1)
        body, fixture = partition(scene, root, rig)
        proof['fixture_validation'] = validate_fixture()
        hip_z = prior['fitted_hip_z']+proposal['proposed_height_delta']
        apply(rig, hip_z=hip_z, hip_y=-.16)
        proof['leg_plans'] = {}
        for side, sign in (('L', -1), ('R', 1)):
            original = next(row for row in prior['fitted_diagnostics']['shoe_pitch_analysis'] if row['side'] == side)
            plan = leg_plan(-.16, hip_z, original['relative_vertices'], 24)
            hip, knee, ankle = Vector((sign*.124, -.16, hip_z)), *[
                Vector((sign*.159, *plan[field])) for field in ('knee', 'ankle')]
            direct_bone(rig, 'thigh.'+side, hip, knee)
            direct_bone(rig, 'shin.'+side, knee, ankle)
            direction = Vector((0, -math.cos(math.radians(24)), -math.sin(math.radians(24))))
            direct_bone(rig, 'foot.'+side, ankle, ankle+direction*rig.data.bones['foot.'+side].length)
            proof['leg_plans'][side] = plan
        proof['hand_fit'] = fit_hands(rig, body)
        proof['physical_metrics'] = measure(root, rig, body, require=False)
        requested = {tuple(cell) for r in proposal['proposed_regions'] for cell in r['cell_indices']}
        proof['curved_support'] = curved_support(capture(bpy.data.objects['Trouser hip bridge']),
                                                capture(bpy.data.objects['Toilet open seat ring']), requested)
        save()
        require_candidate(proof['physical_metrics'], proof['curved_support'], root, rig)
        origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof.update(original_render_dimensions=[scene.render.resolution_x, scene.render.resolution_y],
                     origin_pixels=[origin.x*768, (1-origin.y)*960], camera_matrix=[list(row) for row in scene.camera.matrix_world],
                     ortho_scale=scene.camera.data.ortho_scale)
        if proof['original_render_dimensions'] != [768, 960] or scene.camera.data.type != 'ORTHO':
            raise ValueError('Source camera registration changed')
        scene.render.resolution_percentage = 100
        scene.render.threads_mode, scene.render.threads = 'FIXED', 2
        scene.render.film_transparent = True
        scene.render.image_settings.file_format, scene.render.image_settings.color_mode = 'PNG', 'RGBA'
        bpy.context.preferences.filepaths.save_version = 0
        model = output/'toilet-pose-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model'] = dict(path=model.name, sha256=digest(model))
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        body, fixture = bpy.data.collections['Toilet action body'], bpy.data.collections['Toilet action fixture']
        proof['saved_physical_metrics'] = measure(root, rig, body, require=False)
        proof['saved_curved_support'] = curved_support(capture(bpy.data.objects['Trouser hip bridge']),
                                                      capture(bpy.data.objects['Toilet open seat ring']), requested)
        require_candidate(proof['saved_physical_metrics'], proof['saved_curved_support'], root, rig)
        proof['saved_fixture_validation'] = validate_fixture()
        for label, degrees in FACINGS.items():
            root.rotation_euler.z = rig.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            margin = canvas_margin(scene, (body, fixture))
            path = output/f'{label}-green-0-beauty.png'
            render_pass(scene, body, fixture, 'beauty', path, separate_lines=True)
            proof['renders'].append(dict(facing=label, path=path.name, sha256=digest(path),
                                         complete_geometry_min_pixel_margin=margin))
            save()
        proof['immutable_inputs_preserved'] = all(digest(MODELS/name) == sha for name, sha in inputs.items())
        if not proof['immutable_inputs_preserved']:
            raise ValueError('Source candidate changed an input file')
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]))
