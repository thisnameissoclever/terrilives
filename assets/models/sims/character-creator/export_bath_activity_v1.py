"""Export a complete bath family to an explicit staging directory."""
from pathlib import Path
import hashlib
import json
import os
import sys
import traceback
import bpy
from mathutils import Matrix

BASE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(BASE))
import bath_play_v1 as bath
import export_clips as exporter
import contact_metadata


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def runtime_evidence():
    binary = Path(bpy.app.binary_path).resolve()
    return {'background': bpy.app.background, 'binaryPath': str(binary), 'binarySha256': digest(binary),
            'version': bpy.app.version_string, 'versionTuple': list(bpy.app.version),
            'argv': list(sys.argv), 'cwd': os.getcwd(), 'pid': os.getpid(),
            'selectedEnvironment': {'PYTHONDONTWRITEBYTECODE': os.environ.get('PYTHONDONTWRITEBYTECODE')}}


def run(out, runtime):
    if not bpy.app.background:
        raise ValueError('Bath export must run in the background')
    out.mkdir(parents=True, exist_ok=False)
    prior_path = BASE/'clips/clips.json'
    prior_hash = digest(prior_path)
    library = json.loads(prior_path.read_text())
    source, source_hash, rig, fixture, assembly, toys, sample = bath.open_source()
    bones = list(rig.data.bones)
    baseline = json.loads((BASE/'export/manifest.json').read_text())
    if [bone.name for bone in bones] != [bone['name'] for bone in baseline['bones']]:
        raise ValueError('Bath skeleton differs from the body source')
    rest_error = max(abs(a-b) for bone, expected in zip(bones, baseline['bones'])
                     for a, b in zip(contact_metadata.matrix(bone.matrix_local), expected['rest']))
    if rest_error > 1e-7:
        raise ValueError('Bath rest frames differ from the body source')
    frame = Matrix.LocRotScale(fixture.matrix_world.translation, fixture.matrix_world.to_quaternion(), None)
    inverse = frame.inverted()
    props = [obj for obj in bpy.data.objects if obj.type in ('MESH', 'CURVE')
             and not obj.name.endswith('_source_curve') and exporter.owned_by(obj, fixture)] + toys
    landmarks = contact_metadata.landmarks(rig)
    owners = {obj.name: contact_metadata.assembly_root(obj, rig, fixture).name for obj in props}
    contract = contact_metadata.definition('bath', landmarks, owners)
    contract['bath'] = {'assembly': bath.ASSEMBLY, 'hand': 1, 'grip': list(bath.GRIP), 'waterZ': bath.WATER_Z}
    samples = []
    for index in range(bath.SAMPLES):
        motion = sample(index)
        basis = []
        for bone in bones:
            posed, rest = rig.pose.bones[bone.name].matrix, bone.matrix_local
            if bone.parent:
                posed = rig.pose.bones[bone.parent.name].matrix.inverted() @ posed
                rest = bone.parent.matrix_local.inverted() @ rest
            basis.append(contact_metadata.matrix(rest.inverted() @ posed))
        contacts = contact_metadata.frame('bath', index/bath.SAMPLES, rig, props, fixture)
        contacts['handContact'] = [1., motion['contact']]
        samples.append({'basis': basis, 'bones': [contact_metadata.matrix(rig.pose.bones[bone.name].matrix) for bone in bones],
                        'rig': contact_metadata.matrix(inverse @ rig.matrix_world),
                        'props': {obj.name: {'matrix': contact_metadata.matrix(inverse @ obj.matrix_world),
                                             'visible': True, 'owner': 'actor' if obj in toys else 'fixture'} for obj in props},
                        'eyesClosed': False, 'bookVisible': False, 'contacts': contacts})
    exporter.OUT = out
    parts = exporter.export_parts('bath', props, rig, bones, {'bath': {obj.name for obj in props}})
    for definition in parts['parts']:
        obj = bpy.data.objects[definition['source']]
        if obj in toys:
            definition['conditions'] = [{'bathToy': [obj['bath_toy']]}]
    (out/'bath/parts.json').write_text(json.dumps(parts, separators=(',', ':')))
    library['sources']['bath'] = {'path': source.relative_to(bath.MODELS).as_posix(), 'sha256': source_hash,
        'restError': rest_error, 'rig': rig.name, 'fixture': fixture.name, 'props': [obj.name for obj in props],
        'parts': './bath/parts.json', 'virtualBones': parts['virtualBones'],
        'activityProducer': {name: digest(BASE/name) for name in ('bath_play_v1.py', 'export_bath_activity_v1.py', 'export_clips.py', 'contact_metadata.py')}}
    library['clips']['bath'] = {'family': 'bath', 'sourceAction': None, 'playback': 'loop',
                               'samples': samples, 'contacts': contract}
    if digest(source) != source_hash or digest(prior_path) != prior_hash:
        raise ValueError('An input changed during bath export')
    (out/'clips.json').write_text(json.dumps(library, separators=(',', ':')))
    (out/'receipt.json').write_text(json.dumps({'version': 1, 'runtime': runtime, 'inputLibrarySha256': prior_hash,
        'sourceSha256': source_hash, 'samples': len(samples), 'toyEnvelope': [[-.07, -.09, -.02], [.07, .09, .09]],
        'grip': bath.GRIP, 'outputs': {path.relative_to(out).as_posix(): digest(path)
            for path in sorted(out.rglob('*')) if path.is_file()}}, indent=2))


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(arguments) != 2 or arguments[0] != '--output':
        raise ValueError('Use --output followed by a new absolute staging directory')
    destination = Path(arguments[1])
    if not destination.is_absolute():
        raise ValueError('Bath staging directory must be absolute')
    status = destination.with_suffix('.status.json')
    if status.exists():
        raise ValueError('Bath status must be a fresh path')
    runtime = runtime_evidence()
    status.write_text(json.dumps({'state': 'running', 'runtime': runtime}))
    try:
        run(destination, runtime)
        status.write_text(json.dumps({'state': 'complete', 'runtime': runtime, 'samples': bath.SAMPLES,
                                      'sha256': digest(destination/'receipt.json')}))
    except Exception:
        status.write_text(json.dumps({'state': 'failed', 'runtime': runtime, 'error': traceback.format_exc()}))
        raise
