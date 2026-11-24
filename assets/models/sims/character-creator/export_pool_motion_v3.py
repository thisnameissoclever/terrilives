"""Roundtrip five sparse nominal keys without publishing source or static assets."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import os
import sys
import traceback

import bpy
from mathutils import Matrix

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.dont_write_bytecode = True
sys.path[:0] = [str(BASE), str(MODELS / 'sims/sim-01'), str(MODELS / 'outdoor'), str(MODELS / 'furniture')]
import export_pool_motion_library_v2 as legacy
import pool_activity_pose_v2 as inherited
import pool_activity_pose_v3 as draft
from pool_activity_sample_v2 import capture_channels
from pool_activity_source_guard_v2 import require_pool_published_sample


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runtime_evidence():
    text = lambda value: value.decode('utf-8', errors='replace') if isinstance(value, bytes) else value
    binary = Path(bpy.app.binary_path).resolve()
    return {'background': bpy.app.background, 'binaryPath': str(binary), 'binarySha256': digest(binary),
            'version': bpy.app.version_string, 'versionTuple': list(bpy.app.version),
            'build': {name: text(getattr(bpy.app, name)) for name in ['build_hash', 'build_branch', 'build_commit_date', 'build_commit_time', 'build_platform', 'build_type']},
            'argv': list(sys.argv), 'cwd': os.getcwd(), 'pid': os.getpid(),
            'selectedEnvironment': {'PYTHONDONTWRITEBYTECODE': os.environ.get('PYTHONDONTWRITEBYTECODE')}}


def run(arguments, runtime):
    output, source_path, nominal_path = map(Path, (arguments.output, arguments.source, arguments.nominal))
    if output.exists() or output.resolve().is_relative_to((BASE / 'clips').resolve()):
        raise ValueError('V3 focused export requires a fresh unshipped output')
    source, nominal = json.loads(source_path.read_text()), json.loads(nominal_path.read_text())
    controls_path = BASE / 'pool_activity_motion_v3.json'
    controls = json.loads(controls_path.read_text())
    if digest(source_path) != controls['reference']['fullSourceSha256'] or nominal['inputSha256'] != digest(source_path) or nominal['controlsSha256'] != digest(controls_path):
        raise ValueError('V3 nominal input provenance differs from authenticated source/control data')
    if not nominal['allFivePhysicalKeysPassed']:
        raise ValueError('V3 source experiment requires its retained nominal reference result')
    rig_path = MODELS / 'sims/sim-01/sim-01-rigged.blend'
    rig_hash = digest(rig_path)
    published_path = BASE / 'clips/clips.json'
    published_hash = digest(published_path)
    if rig_hash != source['sourceRigSha256'] or published_hash != source['publishedLibrarySha256']:
        raise ValueError('V3 actual rig or published source differs from inherited source')
    bpy.ops.wm.open_mainfile(filepath=str(rig_path), load_ui=False, use_scripts=False)
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
    names = [bone.name for bone in bones]
    if names != list(inherited.AUTHORING['neutralKey']['basis']) or names != [bone.name for bone in rig.pose.bones]:
        raise ValueError('V3 actual bone order differs from nominal source convention')
    published = json.loads(published_path.read_text())
    clip = copy.deepcopy(source['library']['clips']['pool_enter'])
    records = []
    for phase, index in [(.2, 8), (.225, 9), (.25, 10), (.275, 11), (.3, 12)]:
        nominal_record = next(row for row in nominal['records'] if row['phase'] == phase)
        baseline, baseline_raw = legacy.sample(rig, bones, 'pool_enter', index, inherited)
        if baseline != source['library']['clips']['pool_enter']['samples'][index]:
            raise ValueError(f'Actual inherited source no longer matches source31fe: {index}')
        # Preserve the inherited published-zero layer independently of new V3 ownership.
        published_zero = require_pool_published_sample(baseline, published['clips']['pool_enter']['samples'][index], baseline_raw['authoring'], 'pool_enter', index)
        authoring = draft.apply_nominal_source(rig, names, nominal_record) if phase != .2 else None
        actual = legacy.serialize(rig, baseline['contacts'], bones)
        if authoring is None and actual != baseline:
            raise ValueError('V3 zero-ownership key changed authenticated inherited serialization')
        clip['samples'][index] = actual
        records.append({'phase': phase, 'index': index, 'newV3Owned': authoring is not None,
                        'inheritedPublishedZero': published_zero, 'inheritedSample': baseline,
                        'inheritedAuthoring': baseline_raw['authoring'], 'sample': actual,
                        'matrixBasis': [legacy.focused.values(rig.pose.bones[name].matrix_basis) for name in names],
                        'channels': capture_channels(rig), 'authoring': authoring,
                        'nominalProgram': nominal_record['program'], 'nominalPose': nominal_record['pose'],
                        'nominalGoals': nominal_record.get('contactGoals', [])})
        print(json.dumps({'phase': phase, 'newV3Owned': authoring is not None, 'unchangedInherited': actual == baseline}))
    modules = {Path(module.__file__).resolve().relative_to(MODELS).as_posix(): digest(Path(module.__file__).resolve())
               for module in tuple(sys.modules.values()) if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
               and Path(module.__file__).resolve().is_relative_to(MODELS) and Path(module.__file__).is_file()}
    if digest(rig_path) != rig_hash or digest(published_path) != published_hash:
        raise ValueError('V3 focused export changed actual source rig or published source')
    changed = {9, 10, 11, 12}
    if any(sample != source['library']['clips']['pool_enter']['samples'][index] for index, sample in enumerate(clip['samples']) if index not in changed):
        raise ValueError('V3 focused capsule changed a zero-ownership inherited sample')
    result = {'version': 3, 'status': 'focused unshipped source experiment; no outer join or motion-library admission',
              'blender': bpy.app.version_string, 'runtime': runtime, 'sourceSha256': digest(source_path), 'nominalSha256': digest(nominal_path),
              'controlsSha256': digest(controls_path), 'sourceRigSha256': rig_hash, 'publishedLibrarySha256': published_hash,
              'bones': names, 'records': records, 'unchangedInheritedEntrySamples': len(clip['samples']) - len(changed),
              'library': {'version': 1, 'sources': source['library']['sources'], 'clips': {'pool_enter': clip}},
              'importedProjectModuleHashes': modules,
              'scope': 'Five actual Blender keys, legacy serializer and original pre-control intent. Other entry samples are copied unchanged source31fe; no new timeline, solver, mesh or atlas.'}
    output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    return {'state': 'complete', 'sha256': digest(output), 'records': len(records), 'runtime': runtime}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['source', 'nominal', 'output']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    status = Path(args.output).with_suffix('.status.json')
    runtime = runtime_evidence()
    status.write_text(json.dumps({'state': 'running', 'runtime': runtime}))
    try:
        status.write_text(json.dumps(run(args, runtime)))
    except Exception:
        status.write_text(json.dumps({'state': 'failed', 'runtime': runtime, 'error': traceback.format_exc()}))
        raise
