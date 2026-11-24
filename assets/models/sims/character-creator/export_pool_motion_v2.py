"""Export a focused draft motion capsule without rebuilding or publishing accepted assets."""
from pathlib import Path
import hashlib
import json
import math
import sys
import traceback

import bpy
from mathutils import Matrix

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.dont_write_bytecode = True
sys.path[:0] = [str(BASE), str(MODELS / 'sims/sim-01'), str(MODELS / 'outdoor'), str(MODELS / 'furniture')]
import pool_activity_pose_v1 as reference
import pool_activity_pose_v2 as motion
from pool_activity_sample_v2 import reset_sample


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def values(matrix):
    return [float(matrix[row][column]) for column in range(4) for row in range(4)]


def capture(rig, action, index, producer=motion):
    evidence = {}
    if producer is reference:
        # Reference controls need the same owned reset boundary as the draft's baseline.
        reset_sample(rig)
    contacts = producer.sample(rig, action, index, evidence) if producer is motion else producer.sample(rig, action, index)
    result = {'basis': [values(bone.matrix_basis) for bone in rig.pose.bones],
              'bones': [values(bone.matrix) for bone in rig.pose.bones], 'contacts': contacts}
    if evidence:
        result['sourceAuthoring'] = evidence
    return result


def validate_authoring():
    authoring = motion.AUTHORING
    if authoring['version'] != 2 or authoring['animationSpace'] != 'evaluated-parent-local-delta':
        raise ValueError('Unsupported pool authoring format')
    names = [name for group in authoring['groups'].values() for name in group]
    if set(authoring['curves']) != set(authoring['groups']):
        raise ValueError('Pool authoring requires one independent curve per bone group')
    if len(names) != len(set(names)):
        raise ValueError('Pool authoring groups overlap')
    if set(names) != set(authoring['neutralKey']['basis']) - {'book'}:
        raise ValueError('Pool authoring must own every active bone once')
    for group, curve in authoring['curves'].items():
        if group not in authoring['groups'] or len(curve) < 3 or curve[0]['weight'] != 0 or curve[-1]['weight'] != 0:
            raise ValueError('Pool authoring curve requires unchanged exterior joins')
        previous = -1.
        for key in curve:
            if not math.isfinite(key['phase']) or not 0 <= key['phase'] <= 1 or key['phase'] <= previous or not 0 <= key['weight'] <= 1:
                raise ValueError('Pool authoring curve is not finite and ordered')
            previous = key['phase']
        if motion.curve_weight(curve, authoring['neutralPhase']) != 1:
            raise ValueError('Pool neutral key must be exactly owned by every independent curve')
    for name, matrix in authoring['neutralKey']['basis'].items():
        if len(matrix) != 16 or any(not math.isfinite(value) for value in matrix) or matrix[3:12:4] != [0, 0, 0] or matrix[15] != 1:
            raise ValueError('Pool neutral basis must be finite affine data')
        if name != 'root' and matrix[12:15] != [0, 0, 0]:
            raise ValueError('Pool neutral key changes a child rest offset')


def run(output):
    if not bpy.app.background:
        raise ValueError('Pool motion export requires background Blender')
    validate_authoring()
    source = MODELS / 'sims/sim-01/sim-01-rigged.blend'
    before = digest(source)
    if before != motion.AUTHORING['sourceRigSha256']:
        raise ValueError('Pool draft source rig changed')
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    rig.animation_data.action = None
    rig.matrix_world = Matrix.Identity(4)
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    # Reference hand aims read the authored rail curve; no mesh or atlas is exported.
    from pool_activity_model_v1 import build
    fixture = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    bpy.context.collection.objects.link(fixture)
    build(fixture)
    bpy.context.view_layer.update()
    rig.data.pose_position = 'POSE'
    bpy.context.view_layer.update()
    bones = [bone.name for bone in rig.pose.bones]
    if set(bones) != set(motion.AUTHORING['neutralKey']['basis']):
        raise ValueError('Pool authoring bone set differs from its actual rig')
    controls = []
    for action, index in [('pool_enter', 0), ('pool_enter', 4), ('pool_enter', 8), ('pool_enter', 12), ('pool_enter', 24), ('pool_enter', 40), ('pool_paddle', 0), ('pool_exit_0', 0), ('pool_exit_0', 4), ('pool_exit_0', 40), ('pool_exit_7', 0), ('pool_exit_7', 4)]:
        original = capture(rig, action, index, reference)
        actual = capture(rig, action, index)
        changed = action == 'pool_enter' and index == 8
        if not changed and original != actual:
            raise ValueError(f'Pool draft changed a required original shared/contact key: {action}/{index}')
        controls.append({'action': action, 'index': index, 'unchangedReference': original == actual, 'sample': actual})
    joins = [capture(rig, 'pool_enter', index) for index in [4, 6, 8, 10, 12]]
    if any(any(not math.isfinite(value) for matrix in sample['bones'] for value in matrix) for sample in joins):
        raise ValueError('Pool draft join emitted nonfinite source matrices')
    key = controls[2]['sample']
    key_residuals = {name: max(abs(value - target) for value, target in zip(key['basis'][index], motion.AUTHORING['neutralKey']['basis'][name])) for index, name in enumerate(bones)}
    if digest(source) != before:
        raise ValueError('Pool motion exporter modified the source scene')
    files = [Path(__file__), BASE / 'pool_activity_pose_v2.py', BASE / 'pool_activity_sample_v2.py', BASE / 'pool_activity_motion_v2.json', BASE / 'pool_activity_pose_v1.py', MODELS / 'sims/sim-01/build_rig.py', MODELS / 'outdoor/pool_activity_model_v1.py', MODELS / 'outdoor/pool_activity_layout_v1.py', MODELS / 'furniture/build_parts.py']
    result = {'version': 2, 'status': 'focused draft source import; physical joins and played posture unapproved',
              'blender': bpy.app.version_string, 'sourceRigSha256': before, 'sourceUnchanged': True,
              'producerHashes': {path.relative_to(MODELS).as_posix(): digest(path) for path in files},
              'bones': bones, 'controls': controls, 'joinSamples': joins, 'neutralBasisStorageResiduals': key_residuals,
              'scope': 'Blender source/preference import and exact unchanged handoffs only; no body surface or physical graph admission'}
    result['importedProjectModuleHashes'] = {Path(module.__file__).resolve().relative_to(MODELS).as_posix(): digest(Path(module.__file__).resolve())
        for module in tuple(sys.modules.values()) if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
        and Path(module.__file__).resolve().is_relative_to(MODELS) and Path(module.__file__).is_file()}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(arguments) != 2 or arguments[0] != '--output':
        raise ValueError('Specify an explicit draft --output path')
    target = Path(arguments[1]).resolve()
    status = target.with_suffix('.status.json')
    status.parent.mkdir(parents=True, exist_ok=True)
    status.write_text(json.dumps({'state': 'running'}))
    try:
        run(target)
        status.write_text(json.dumps({'state': 'complete', 'receiptSha256': digest(target)}))
    except Exception:
        status.write_text(json.dumps({'state': 'failed', 'error': traceback.format_exc()}))
        raise
