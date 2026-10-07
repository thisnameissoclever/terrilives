"""Immutable-source, support-first bath measurement before fitting limbs or water."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(BASE), str(BASE.parent), str(MODELS/'furniture')]
from bath_pose import apply_support_frame
from bath_contact import indexed_torso_diagnostic, measure_support
from check_bathtub_scene import validate as validate_fixture
from bath_articulation_v1 import run_experiment

SOURCE = MODELS/'bathroom/owner-review-pending/bathtub/candidate-02/bathtub-authoring.blend'
RIG_SOURCE = MODELS/'sims/sim-01/sim-01-rigged.blend'
EXPECTED_SOURCE = '4eb71e029fd7904cffa612fbec122831b86911f24643ff92099c8c731fc25f56'
EXPECTED_RIG = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def partition(scene, root, rig):
    body, fixture = [bpy.data.collections.new(name) for name in ('Bath diagnostic body', 'Bath diagnostic fixture')]
    scene.collection.children.link(body)
    scene.collection.children.link(fixture)
    furniture, bodies = set(root.children_recursive), set(rig.children_recursive)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH', 'CURVE'):
            continue
        target = fixture if obj in furniture else body if obj in bodies else None
        if target is None:
            if not obj.hide_render:
                raise ValueError(f'Unowned bath diagnostic geometry: {obj.name}')
            continue
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        target.objects.link(obj)
    for collection in bpy.data.collections:
        collection.hide_render = False
        collection.hide_viewport = False
    bpy.context.view_layer.update()
    return body, fixture


def run_support_diagnostic(output, indexed=False, articulation=False):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender with a new absolute diagnostic directory')
    output.mkdir(parents=True, exist_ok=False)
    paths = {Path(module.__file__).resolve() for module in sys.modules.values()
             if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
             and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    paths.update((SOURCE, RIG_SOURCE, SOURCE.parent/'proof.json',
                  MODELS/'sims/sim-01/registered-canvas-proof.json',
                  MODELS/'bathroom/bathtub_geometry.py', MODELS/'bathroom/bathtub_model.py'))
    support_reference = BASE/'review/bath/prototype-01-support-diagnostic/proof.json'
    indexed_reference = BASE/'review/bath/prototype-02-same-pose-torso-diagnostic/proof.json'
    if indexed or articulation:
        paths.add(support_reference)
    if articulation:
        paths.add(indexed_reference)
    inputs = {path.relative_to(MODELS).as_posix():digest(path) for path in sorted(paths)}
    for path in sorted(paths):
        if path.suffix == '.py':
            target = output/'source'/path.relative_to(MODELS)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    proof = dict(state='running', mode='versioned-lower-garment-binding-v1-causal-experiment' if articulation
                 else 'same-pose-indexed-torso-diagnostic' if indexed
                 else 'support-first-measure-only', inputs=inputs, cases=[],
        blender_version=bpy.app.version_string, water_present=False, limbs_fitted=False,
        beauty_rendered=False, source_acceptance='unverified',
        purpose='Find actual finite hip and upper-back support before fitting arms, legs or water coverage')
    def save():
        (output/'proof.json').write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if digest(SOURCE) != EXPECTED_SOURCE or digest(RIG_SOURCE) != EXPECTED_RIG:
            raise ValueError('Immutable bath or shared-rig source hash changed')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        scene = bpy.context.scene
        root, rig = bpy.data.objects['BATHTUB_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        if root.location.length > 1e-7 or any(abs(v-1) > 1e-6 for v in root.scale):
            raise ValueError('Accepted tub is not the unchanged centred unit-scale source')
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        rig.location = (0, 0, 0)
        rig.animation_data.action = None
        scene.frame_set(1)
        body, fixture = partition(scene, root, rig)
        proof['fixture_validation_before'] = validate_fixture()
        if scene.camera.data.type != 'ORTHO' or [scene.render.resolution_x, scene.render.resolution_y] != [1280, 1408]:
            raise ValueError('Accepted bath camera or original canvas changed')
        origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof.update(original_render_dimensions=[1280, 1408], origin_pixels=[origin.x*1280, (1-origin.y)*1408],
                     camera_matrix=[list(row) for row in scene.camera.matrix_world], ortho_scale=scene.camera.data.ortho_scale,
                     canonical_fixture_origin=list(root.location), authored_source_rotation=0,
                     head_direction='-Y, away from +Y deck taps', face_direction='upward')
        if articulation:
            reference = json.loads(support_reference.read_text())['cases'][0]
            parameters = {name:reference['parameters'][name] for name in
                          ('hip_y','hip_z','hip_angle','back_angle','head_angle')}
            spine_matrix = json.loads(indexed_reference.read_text())['indexed_torso_diagnostic']['rigid_frame_replay']['spine_deform_matrix']
            def record(name,value):
                proof[name]=value
                save()
            proof['same_rejected_frame_parameters']=parameters
            proof['binding_version']=1
            proof['source_acceptance']=False
            proof['causal_result']=run_experiment(root,rig,body,parameters,spine_matrix,record)
            measured=proof['complete_derived_measurement']['support']['joint_targets']
            if any(abs(a-b)>1e-7 for name in reference['joint_targets'] for field in ('head','tail')
                   for a,b in zip(reference['joint_targets'][name][field],measured[name][field])):
                raise ValueError('Versioned binding diagnostic changed rejected support01 frame')
            proof['fixture_validation_after']=validate_fixture()
            proof['immutable_sources_byte_identical']=all(digest(MODELS/name)==expected for name,expected in inputs.items())
            if not proof['immutable_sources_byte_identical']:
                raise ValueError('Versioned binding diagnostic changed immutable source bytes')
            proof['state']='complete'
            save()
            return
        if indexed:
            reference = json.loads(support_reference.read_text())['cases'][0]
            parameters = {name:reference['parameters'][name] for name in
                          ('hip_y', 'hip_z', 'hip_angle', 'back_angle', 'head_angle')}
            proof['same_pose_parameters'] = apply_support_frame(rig, **parameters)
            before = measure_support(root, rig, body)
            if any(abs(a-b) > 1e-7 for name in reference['joint_targets'] for field in ('head', 'tail')
                   for a, b in zip(reference['joint_targets'][name][field], before['joint_targets'][name][field])):
                raise ValueError('Indexed diagnostic changed support01 case0 pose')
            proof['reference_support_case'] = 0
            proof['same_pose_as_support_01_case_0'] = True
            proof['support_before'] = before
            proof['indexed_torso_diagnostic'] = indexed_torso_diagnostic(root, rig, body)
            proof['support_after'] = measure_support(root, rig, body)
            if proof['support_after']['joint_targets'] != before['joint_targets']:
                raise ValueError('Indexed diagnostic did not restore the exact pose')
            proof['fixture_validation_after'] = validate_fixture()
            proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected for name, expected in inputs.items())
            if not proof['immutable_sources_byte_identical']:
                raise ValueError('Indexed bath diagnostic changed immutable input bytes')
            proof['state'] = 'complete'
            save()
            return
        for hip_angle in (95, 105, 115):
            for back_angle in (80, 90, 100):
                parameters = apply_support_frame(rig, hip_y=.35, hip_z=.35,
                                                  hip_angle=hip_angle, back_angle=back_angle)
                initial = measure_support(root, rig, body)
                hip_z = .35+.001-initial['support']['hip']['min_gap']
                parameters = apply_support_frame(rig, hip_y=.35, hip_z=hip_z,
                                                  hip_angle=hip_angle, back_angle=back_angle)
                measured = measure_support(root, rig, body)
                proof['cases'].append(dict(parameters=parameters,
                    calibration=dict(initial_hip_z=.35, initial_actual_hip_min_gap=initial['support']['hip']['min_gap'],
                                     fitted_hip_z=hip_z, intended_min_hip_gap=.001), **measured))
                save()
        passing = [i for i, case in enumerate(proof['cases']) if case['support_state'] == 'passed']
        proof['supported_case_indices'] = passing
        proof['supported_upper_body_found'] = bool(passing)
        proof['fixture_validation_after'] = validate_fixture()
        if not all(digest(MODELS/name) == expected for name, expected in inputs.items()):
            raise ValueError('Bath diagnostic changed immutable input bytes')
        proof['immutable_sources_byte_identical'] = True
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected for name, expected in inputs.items())
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if not any(flag in args for flag in ('--support-diagnostic','--contact-diagnostic','--articulation-v1')):
        raise ValueError('Bath source is support-first; fit limbs and coverage only after the retained support diagnostic')
    run_support_diagnostic(Path(args[0]), '--contact-diagnostic' in args, '--articulation-v1' in args)
