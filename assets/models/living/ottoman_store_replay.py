"""Prepare and inspect contact replay through the authorized detached launcher."""
import json
import argparse
import shutil
import uuid
from pathlib import Path

from ottoman_bundle import digest, load_bundle, relative_path
from ottoman_replay import ROOT, CATALOG, BASE, prepare_stage, stage_input_names

ENGINE = ['4.5.14 LTS', '62c1db4208e8']
OUTPUTS = (BASE + 'strict-contact-proof-02.json', BASE + 'occupancy-regression-proof.json')


def checked_file(root, name, expected):
    path = (root / relative_path(name, historical=True)).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file() or digest(path) != expected:
        raise ValueError(f'Replay input hash or path differs: {name}')
    return path


def prepare_job(directory):
    """Keep accepted bytes untouched and give every launch a new identity."""
    directory = Path(directory).resolve()
    bundle = load_bundle(CATALOG, root=ROOT)
    directory.mkdir(parents=True, exist_ok=False)
    source = prepare_stage(bundle, 'contact', directory / 'source')
    worker = directory / 'worker.py'
    shutil.copyfile(Path(__file__).with_name('ottoman_blender_job.py'), worker)
    request = {'job_id': uuid.uuid4().hex, 'bundle_sha256': digest(CATALOG),
        'worker_sha256': digest(worker), 'inputs': {
            str(path.relative_to(source)).replace('\\', '/'): digest(path)
            for path in sorted(source.rglob('*')) if path.is_file()}}
    with (directory / 'request.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(request, indent=2) + '\n')
    return request


def inspect_result(directory):
    """A missing receipt means unobserved completion, not failure or success."""
    directory = Path(directory).resolve()
    request = json.loads((directory / 'request.json').read_text(encoding='utf-8'))
    result = directory / 'result.json'
    if not result.exists():
        return None
    report = json.loads(result.read_text(encoding='utf-8'))
    if report.get('job_id') != request['job_id']:
        raise ValueError('Blender replay job identity differs')
    if report.get('state') != 'complete':
        raise ValueError('Blender replay failed: ' + str(report.get('error', 'invalid state')))
    if report.get('request_sha256') != digest(directory / 'request.json'):
        raise ValueError('Blender replay request hash differs')
    if report.get('engine') != ENGINE:
        raise ValueError('Blender replay engine differs')
    if report.get('background') is not True:
        raise ValueError('Blender replay was not background execution')
    if report.get('source_bytes_unchanged') is not True:
        raise ValueError('Blender replay source bytes changed')
    source = directory / 'source'
    if not request.get('inputs'):
        raise ValueError('Missing replay input hashes')
    checked_file(directory, 'worker.py', request['worker_sha256'])
    for name, expected in request['inputs'].items():
        checked_file(source, name, expected)
    resources = report.get('resources', [])
    models = sorted(name for name in request['inputs'] if name.endswith('.blend'))
    if not models or sorted(row['model'] for row in resources) != models:
        raise ValueError('Incomplete Blender resource inventory')
    if any(row.get('required_external_paths') != [] for row in resources):
        raise ValueError('Unaccounted external resources in Blender source')
    if set(report.get('outputs', {})) != set(OUTPUTS):
        raise ValueError('Incomplete Blender output inventory')
    outputs = [json.loads(checked_file(source, name, report['outputs'][name]).read_text())
               for name in OUTPUTS]
    if any(row.get('state') != 'complete' or row.get('source_bytes_unchanged') is not True
           for row in outputs):
        raise ValueError('Incomplete contact output')
    if (outputs[0].get('accepted') is not True
            or [row.get('frame') for row in outputs[0].get('samples', [])] != [1, 2, 3, 4]):
        raise ValueError('Missing accepted contact samples')
    cases = outputs[1].get('cases', [])
    if len(cases) != 7 or any(row.get('passed') is not True for row in cases):
        raise ValueError('Missing occupancy regression cases')
    return report


def collect_result(directory, *, catalog=CATALOG, root=ROOT):
    directory = Path(directory).resolve()
    report = inspect_result(directory)
    if report is None:
        return None
    request = json.loads((directory / 'request.json').read_text())
    if digest(catalog) != request['bundle_sha256']:
        raise ValueError('Accepted bundle changed during replay')
    bundle = load_bundle(catalog, root=root)
    expected_inputs = {name: bundle.records[name]['sha256']
                       for name in stage_input_names(bundle, 'contact')}
    if request['inputs'] != expected_inputs:
        raise ValueError('Replay inputs differ from the pinned contact-stage inventory')
    accepted = json.loads(bundle.resolve(OUTPUTS[0]).read_text())
    actual = json.loads((directory / 'source' / OUTPUTS[0]).read_text())
    if actual['samples'] != accepted['samples']:
        raise ValueError('Replayed contact measurements differ from accepted evidence')
    accepted_cases = json.loads(bundle.resolve(OUTPUTS[1]).read_text())['cases']
    actual_cases = json.loads((directory / 'source' / OUTPUTS[1]).read_text())['cases']
    if actual_cases != accepted_cases:
        raise ValueError('Replayed occupancy cases differ from accepted evidence')
    return {'state': 'complete', 'job_id': request['job_id'],
        'models_audited': len(report['resources']), 'contact_samples': 4,
        'regression_cases': 7, 'accepted_measurements_equal': True,
        'archive_bytes_unchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'collect'))
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    if args.operation == 'prepare':
        request = prepare_job(args.directory)
        print(json.dumps({'state': 'prepared', 'job_id': request['job_id'],
                          'directory': str(args.directory.resolve())}))
        return
    report = collect_result(args.directory)
    print(json.dumps(report if report is not None else {'state': 'completion_not_observed',
        'instruction': 'Inspect the actual Blender process; do not relaunch this directory.'}))


if __name__ == '__main__':
    main()
