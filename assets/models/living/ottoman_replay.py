"""Run archived ottoman recipes in fresh, copy-only directories."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from ottoman_bundle import digest, load_bundle

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'assets/models/living/owner-review-pending/ottoman/sitting-02/bundle.json'
BASE = 'output/ottoman-sit-candidate-02/'
STAGES = ('source-tests', 'contact', 'render', 'author')


def prepare_stage(bundle, stage, destination):
    if stage not in STAGES:
        raise ValueError(f'Unknown ottoman replay stage: {stage}')
    names = {name for name in bundle.records if name.endswith('.py')}
    if stage == 'source-tests':
        names.add(BASE + 'contributions/raw-proof.json')
    else:
        names.update(name for name in bundle.records if name.startswith('assets/'))
        if stage != 'author':
            names.update({BASE + 'ottoman-sit-authoring.blend', BASE + 'status.json'})
            if stage == 'contact':
                names.add('output/ottoman-sit-candidate-01/ottoman-sit-authoring.blend')
            else:
                names.add(BASE + 'strict-contact-proof-02.json')
    return bundle.materialize(sorted(names), destination)


def blender_command(executable, env):
    executable = Path(executable).resolve()
    if not executable.is_file():
        raise ValueError('This stage requires an existing Blender executable')
    prefix = [str(executable), '--background', '--factory-startup', '--python-exit-code', '1']
    probe = subprocess.run(prefix + ['--python-expr',
        'import bpy,json; print("OTTOMAN_ENGINE=" + json.dumps([bpy.app.version_string,bpy.app.build_hash.decode()]))'],
        cwd=ROOT, env=env, capture_output=True, text=True, check=True)
    line = next((v for v in probe.stdout.splitlines() if v.startswith('OTTOMAN_ENGINE=')), '')
    if not line or json.loads(line.removeprefix('OTTOMAN_ENGINE=')) != ['4.5.14 LTS', '62c1db4208e8']:
        raise ValueError('Blender build differs from accepted ottoman source')
    return prefix + ['--python']


def run_commands(bundle, catalog, stage, destination, commands, env):
    report = {'stage': stage, 'state': 'running', 'bundle_sha256': digest(catalog), 'commands': []}
    failure = None
    try:
        for command in commands:
            result = subprocess.run(command, cwd=destination, env=env, capture_output=True, text=True)
            report['commands'].append({'argv': command, 'exit_code': result.returncode,
                                       'stdout': result.stdout, 'stderr': result.stderr})
            if result.returncode:
                raise RuntimeError(f'Ottoman replay failed: {command[-1]}\n{result.stderr}')
    except BaseException as error:
        failure = error
        report['error'] = str(error)
    finally:
        report['archive_bytes_unchanged'] = False
        try:
            if digest(catalog) != report['bundle_sha256']:
                raise ValueError('Ottoman bundle catalog changed during replay')
            for name in bundle.records:
                bundle.resolve(name)
            report['archive_bytes_unchanged'] = True
        except Exception as error:
            report['archive_error'] = str(error)
        report['state'] = 'complete' if failure is None and report['archive_bytes_unchanged'] else 'failed'
        journal = destination / 'replay-result.json'
        with journal.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, indent=2) + '\n')
    if failure is not None:
        raise failure
    if report['state'] != 'complete':
        raise RuntimeError(report['archive_error'])
    return journal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, choices=STAGES)
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--blender', type=Path)
    args = parser.parse_args()
    bundle = load_bundle(CATALOG, root=ROOT)
    env = os.environ.copy()
    env.pop('PYTHONPATH', None)
    blender = None
    if args.stage != 'source-tests':
        if os.name != 'nt':
            parser.error('Unchanged archived Blender recipes require Windows path semantics')
        if args.blender is None:
            parser.error('This stage requires --blender with an existing executable')
        blender = blender_command(args.blender, env)
    destination = prepare_stage(bundle, args.stage, args.destination)
    python = [sys.executable, '-I']
    commands = [python + ['-m', 'unittest', 'discover', '-s', 'output', '-p', 'test_*.py', '-v']]
    if blender is not None:
        commands = {
            'contact': [blender + ['output/check-ottoman-sit-candidate-02.py'],
                        blender + ['output/prove-ottoman-occupancy.py']],
            'render': [blender + ['output/render-ottoman-sit-contributions.py'],
                       python + ['output/export-ottoman-sit-review.py'],
                       blender + ['output/read-ottoman-cadence.py'],
                       python + ['output/review-ottoman-cadence.py']],
            'author': [blender + ['output/build-ottoman-sit-refined.py']],
        }[args.stage]
    journal = run_commands(bundle, CATALOG, args.stage, destination, commands, env)
    print(f'Completed {args.stage}; new evidence: {journal}')


if __name__ == '__main__':
    main()
