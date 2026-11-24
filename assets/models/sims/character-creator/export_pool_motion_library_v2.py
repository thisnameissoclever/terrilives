"""Export an explicit unshipped pool-only library without meshes or published-file writes."""
from pathlib import Path
import copy
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
import export_pool_motion_v2 as focused
import pool_activity_pose_v2 as motion
import pool_activity_pose_v1 as reference
from pool_activity_sample_v2 import reset_sample, capture_channels
from pool_activity_source_guard_v2 import require_pool_published_sample


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def serialize(rig, contacts, bones):
    # Preserve the existing full-library rest/parent WORLD serialization operation order.
    basis = []
    for bone in bones:
        posed, rest = rig.pose.bones[bone.name].matrix, bone.matrix_local
        if bone.parent:
            posed = rig.pose.bones[bone.parent.name].matrix.inverted() @ posed
            rest = bone.parent.matrix_local.inverted() @ rest
        basis.append(focused.values(rest.inverted() @ posed))
    return {'basis': basis, 'bones': [focused.values(rig.pose.bones[bone.name].matrix) for bone in bones],
            'rig': focused.values(Matrix.Identity(4)), 'props': {}, 'eyesClosed': False,
            'bookVisible': False, 'contacts': contacts}


def sample(rig, bones, name, index, producer):
    evidence = {}
    if producer is reference:
        reset_sample(rig)
        contacts = producer.sample(rig, name, index)
    else:
        contacts = producer.sample(rig, name, index, evidence)
    return serialize(rig, contacts, bones), {'matrixBasis': [focused.values(rig.pose.bones[bone.name].matrix_basis) for bone in bones],
                                          'channels': capture_channels(rig), 'authoring': evidence}


def run(output):
    if not bpy.app.background:
        raise ValueError('Pool source library export requires background Blender')
    published = BASE / 'clips/clips.json'
    if output == published.resolve() or output.is_relative_to((BASE / 'clips').resolve()):
        raise ValueError('Export to an explicit unshipped review path outside published clips')
    focused.validate_authoring()
    source = MODELS / 'sims/sim-01/sim-01-rigged.blend'
    source_hash, published_hash = digest(source), digest(published)
    if source_hash != motion.AUTHORING['sourceRigSha256']:
        raise ValueError('Pool source rig differs from authenticated authoring')
    old = json.loads(published.read_text())
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    rig.animation_data.action = None
    rig.matrix_world = Matrix.Identity(4)
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    from pool_activity_model_v1 import build
    fixture = bpy.data.objects.new('POOL_MODEL_ROOT', None)
    bpy.context.collection.objects.link(fixture)
    build(fixture)
    bpy.context.view_layer.update()
    rig.data.pose_position = 'POSE'
    bpy.context.view_layer.update()
    bones = list(rig.data.bones)
    if [bone.name for bone in bones] != [bone.name for bone in rig.pose.bones]:
        raise ValueError('Pool source data and pose bone order differ')
    specs = [('pool_enter', motion.ENTRY_SAMPLES), ('pool_paddle', motion.PADDLE_SAMPLES)]
    specs += [('pool_exit_' + str(index), motion.EXIT_SAMPLES) for index in range(motion.PADDLE_SAMPLES)]
    clips, records, zero_controls, published_changes = {}, [], 0, []
    for name, count in specs:
        clip = copy.deepcopy(old['clips'][name])
        clip['samples'] = []
        for index in range(count):
            actual, raw = sample(rig, bones, name, index, motion)
            if any(not math.isfinite(value) for key in ['basis', 'bones'] for matrix in actual[key] for value in matrix):
                raise ValueError(f'Pool source emitted nonfinite matrices: {name}/{index}')
            if not raw['authoring']:
                expected, original = sample(rig, bones, name, index, reference)
                if actual != expected or raw['matrixBasis'] != original['matrixBasis'] or raw['channels'] != original['channels']:
                    raise ValueError(f'Pool zero-weight output differs from owned reference: {name}/{index}')
                zero_controls += 1
            previous = old['clips'][name]['samples'][index]
            require_pool_published_sample(actual, previous, raw['authoring'], name, index)
            basis_change = max(abs(a-b) for left,right in zip(actual['basis'], previous['basis']) for a,b in zip(left,right))
            world_change = max(abs(a-b) for left,right in zip(actual['bones'], previous['bones']) for a,b in zip(left,right))
            if basis_change or world_change:
                published_changes.append({'clip': name, 'index': index, 'authored': bool(raw['authoring']),
                                          'maximumBasisDifference': basis_change, 'maximumWorldDifference': world_change})
            clip['samples'].append(actual)
            records.append({'clip': name, 'index': index, **raw})
        clips[name] = clip
    for name,index in [('pool_enter',0),('pool_enter',4),('pool_enter',12),('pool_enter',24),('pool_enter',40),
                       ('pool_paddle',0),('pool_exit_0',0),('pool_exit_0',4),('pool_exit_0',40),('pool_exit_7',0),('pool_exit_7',4)]:
        if clips[name]['samples'][index] != old['clips'][name]['samples'][index]:
            raise ValueError(f'Pool original exact shared control changed serialization: {name}/{index}')
    modules = {Path(module.__file__).resolve().relative_to(MODELS).as_posix(): digest(Path(module.__file__).resolve())
               for module in tuple(sys.modules.values()) if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
               and Path(module.__file__).resolve().is_relative_to(MODELS) and Path(module.__file__).is_file()}
    if digest(source) != source_hash or digest(published) != published_hash:
        raise ValueError('Pool review export changed original rig or published library')
    source_record = copy.deepcopy(old['sources']['pool'])
    source_record['producerHashes'] = modules
    result = {'version': 2, 'status': 'unshipped full source input; physical trajectory and played quality unapproved',
              'blender': bpy.app.version_string, 'sourceRigSha256': source_hash, 'publishedLibrarySha256': published_hash,
              'library': {'version': 1, 'sources': {'pool': source_record}, 'clips': clips},
              'rawSource': records, 'zeroWeightReferenceControls': zero_controls, 'exactPublishedSharedControls': 11,
              'publishedDifferences': published_changes, 'importedProjectModuleHashes': modules,
              'serializerSha256': digest(Path(__file__)), 'sampleCount': sum(len(clip['samples']) for clip in clips.values()),
              'scope': 'All source samples using existing full-library serializer. Raw channels retained separately; no physical scaling, mesh rebuild, publication or graph admission.'}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    return {'state': 'complete', 'sha256': digest(output), 'sampleCount': result['sampleCount'], 'zeroWeightControls': zero_controls}


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(arguments) != 2 or arguments[0] != '--output':
        raise ValueError('Specify an explicit unshipped --output path')
    target = Path(arguments[1]).resolve()
    status = target.with_suffix('.status.json')
    status.parent.mkdir(parents=True, exist_ok=True)
    status.write_text(json.dumps({'state': 'running'}))
    try:
        status.write_text(json.dumps(run(target)))
    except Exception:
        status.write_text(json.dumps({'state': 'failed', 'error': traceback.format_exc()}))
        raise
