"""Build, exercise and publish the reviewed mutation runtime using bounded resources."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
RECIPE = ROOT / '.github/runtime'
RECIPE_NAMES = ('Dockerfile', 'inputs.lock.json', 'inventory.py', '.dockerignore')
REGISTRY_REPOSITORY = 'ghcr.io/thisnameissoclever/terrilives-mutation-runtime'
INVENTORY_PATH = '/opt/terrilives-mutation-runtime/inventory.json'
TOKEN_NAMES = ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN')

# The smoke test runs with a read-only image, an unprivileged UID and no network.
SMOKE = r'''
import json, os, pathlib, signal, subprocess, tempfile
def run(*args):
    subprocess.run(args, check=True)
with tempfile.TemporaryDirectory(prefix='runtime-smoke-') as temporary:
    root = pathlib.Path(temporary)
    os.environ['CARGO_HOME'] = str(root / 'cargo')
    os.environ['CARGO_TARGET_DIR'] = str(root / 'target')
    os.environ['HOME'] = str(root / 'home')
    pathlib.Path(os.environ['HOME']).mkdir()
    source = root / 'smoke.rs'
    source.write_text('fn main() { assert_eq!(2 + 2, 4); }')
    run('rustc', str(source), '-o', str(root / 'native'))
    run(str(root / 'native'))
    run('rustc', '--target', 'wasm32-unknown-unknown', str(source), '-o', str(root / 'smoke.wasm'))
    run('cargo', 'init', '--lib', '--name', 'runtime_smoke', str(root / 'crate'))
    run('cargo', 'test', '--offline', '--manifest-path', str(root / 'crate/Cargo.toml'))
    run('cargo', 'clippy', '--offline', '--manifest-path', str(root / 'crate/Cargo.toml'), '--', '-Dwarnings')
    run('cargo', 'fmt', '--manifest-path', str(root / 'crate/Cargo.toml'), '--', '--check')
    run('git', '-c', 'init.defaultBranch=main', 'init', str(root / 'checkout'))
    run('git', '-C', str(root / 'checkout'), 'status', '--porcelain')
    child = subprocess.Popen(['bash', '-c', 'trap "wait; exit 143" TERM; sleep 30 & echo $!; wait'],
                             stdout=subprocess.PIPE, text=True, start_new_session=True)
    descendant = int(child.stdout.readline())
    os.killpg(child.pid, signal.SIGTERM)
    child.wait(timeout=5)
    assert not pathlib.Path('/proc', str(descendant)).exists()
    receipt = root / 'artifact.json'
    receipt.write_text(json.dumps({'native': True, 'wasm': True, 'uid': os.getuid()}))
    assert json.loads(receipt.read_text())['uid'] == 1001
    assert pathlib.Path(os.environ['CARGO_HOME']).is_relative_to(root)
    assert pathlib.Path(os.environ['CARGO_TARGET_DIR']).is_relative_to(root)
print('runtime smoke passed')
'''

# Each fault lives in an ephemeral container layer with no host mounts or network.
NEGATIVE_CONTROLS = r'''
import importlib.util, json, os, pathlib, shutil, tempfile
spec = importlib.util.spec_from_file_location('inventory', '/opt/terrilives-mutation-runtime/recipe/inventory.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
baseline = json.loads(runtime.INVENTORY.read_bytes())
def require_refusal():
    try:
        runtime.verify()
    except ValueError:
        return
    raise AssertionError('changed runtime was accepted')
shell = pathlib.Path('/usr/bin/sh')
assert shell.is_symlink()
original_target = os.readlink(shell)
dash = baseline['tools']['dash']
bash = baseline['tools']['bash']
assert baseline['tools']['sh'] == dash
try:
    shell.unlink()
    shell.symlink_to(bash)
    assert runtime.digest(dash) == baseline['files'][dash]
    assert runtime.digest(bash) == baseline['files'][bash]
    require_refusal()
finally:
    shell.unlink()
    shell.symlink_to(original_target)
runtime.verify()
original_path = os.environ['PATH']
with tempfile.TemporaryDirectory(prefix='assembler-shadow-') as directory:
    assembler = baseline['tools']['as']
    shadow = pathlib.Path(directory) / 'as'
    shutil.copy2(assembler, shadow)
    try:
        os.environ['PATH'] = directory + ':' + original_path
        assert runtime.digest(assembler) == baseline['files'][assembler] == runtime.digest(shadow)
        assert pathlib.Path(shutil.which('as')).resolve() == shadow
        require_refusal()
    finally:
        os.environ['PATH'] = original_path
runtime.verify()
print('runtime negative controls passed: sh alias and assembler PATH shadow')
'''


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def recipe_files():
    return {'.github/runtime/' + name: sha256(RECIPE / name) for name in RECIPE_NAMES}


def clean_environment():
    return {key: value for key, value in os.environ.items() if key not in TOKEN_NAMES}


def command(args, *, capture=False, env=None, stdin=None):
    result = subprocess.run(args, check=True, env=env or clean_environment(),
                            input=stdin, stdout=subprocess.PIPE if capture else None,
                            text=True)
    return result.stdout.strip() if capture else None


def validate_tag(tag):
    if not re.fullmatch(re.escape(REGISTRY_REPOSITORY) + r':[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}', tag):
        raise ValueError('expected a tag in the repository-owned mutation runtime package')
    return tag


def validate_image(image):
    if not re.fullmatch(re.escape(REGISTRY_REPOSITORY) + r'@sha256:[0-9a-f]{64}', image):
        raise ValueError('expected the repository-owned image at an immutable sha256 digest')
    return image


def receipt(image, inventory_path):
    validate_image(image)
    raw = Path(inventory_path).read_bytes()
    inventory = json.loads(raw)
    if canonical(inventory) != raw:
        raise ValueError('embedded inventory is not canonical')
    if inventory.get('version') != 1 or inventory.get('architecture') != 'x86_64':
        raise ValueError('unexpected inventory version or architecture')
    if inventory.get('recipe_inputs') != recipe_files():
        raise ValueError('embedded inventory belongs to another recipe')
    return {'version': 1, 'image': image, 'inventory_sha256': hashlib.sha256(raw).hexdigest(),
            'recipe_files': recipe_files(),
            'source_sha': command(['git', 'rev-parse', 'HEAD'], capture=True),
            'run_id': os.environ.get('GITHUB_RUN_ID', '')}


def verify(image, destination, memory_gib=4):
    destination.mkdir(parents=True, exist_ok=True)
    common = ['docker', 'run', '--rm', f'--memory={memory_gib}g', '--cpus=2', '--network=none',
              '--read-only', '--tmpfs', '/tmp:rw,exec,size=536870912', '--user=1001:1001']
    command([*common, image, 'python3', '/opt/terrilives-mutation-runtime/recipe/inventory.py', 'verify'])
    command([*common, image, 'python3', '-c', SMOKE])
    command(['docker', 'run', '--rm', f'--memory={memory_gib}g', '--cpus=2', '--network=none',
             image, 'python3', '-c', NEGATIVE_CONTROLS])
    raw = command([*common, image, 'python3', '-c',
                   f'import pathlib; print(pathlib.Path({INVENTORY_PATH!r}).read_text(), end="")'],
                  capture=True).encode() + b'\n'
    inventory_path = destination / 'inventory.json'
    inventory_path.write_bytes(raw)
    if json.loads(raw).get('recipe_inputs') != recipe_files():
        raise ValueError('verified image does not contain the current reviewed recipe')
    return inventory_path


def build(tag, destination, memory_gib=4):
    validate_tag(tag)
    if not isinstance(memory_gib, int) or not 1 <= memory_gib <= 4:
        raise ValueError('build memory must be between 1 and 4 GiB')
    lock = json.loads((RECIPE / 'inputs.lock.json').read_text())
    builder = 'terrilives-mutation-' + uuid.uuid4().hex[:12]
    command(['docker', 'buildx', 'create', '--name', builder, '--driver', 'docker-container',
             '--driver-opt', 'image=' + lock['buildkit_image'], '--driver-opt', f'memory={memory_gib}g',
             '--driver-opt', 'cpu-period=100000', '--driver-opt', 'cpu-quota=200000'])
    try:
        command(['docker', 'buildx', 'build', '--builder', builder, '--platform', 'linux/amd64',
                 '--provenance=false', '--load', '--tag', tag, '--file', str(RECIPE / 'Dockerfile'),
                 str(RECIPE)])
        verify(tag, destination, memory_gib)
        inspection = json.loads(command(['docker', 'image', 'inspect', tag], capture=True))[0]
        destination.joinpath('local-image.json').write_bytes(canonical({
            'tag': tag, 'image_id': inspection['Id'], 'recipe_files': recipe_files()}))
    finally:
        command(['docker', 'buildx', 'rm', builder])


def publish(tag, destination):
    validate_tag(tag)
    inventory = verify(tag, destination)
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    actor = os.environ.get('GITHUB_ACTOR')
    if not token or not actor:
        raise ValueError('publication requires the owner-dispatched job token and actor')
    with tempfile.TemporaryDirectory(prefix='mutation-registry-auth-') as temporary:
        environment = {**clean_environment(), 'DOCKER_CONFIG': temporary}
        try:
            command(['docker', 'login', 'ghcr.io', '--username', actor, '--password-stdin'],
                    env=environment, stdin=token)
            command(['docker', 'push', tag], env=environment)
            inspected = json.loads(command(['docker', 'image', 'inspect', tag], capture=True,
                                           env=environment))[0]
            candidates = [value for value in inspected.get('RepoDigests', [])
                          if value.startswith(REGISTRY_REPOSITORY + '@sha256:')]
            if len(set(candidates)) != 1:
                raise ValueError('publication did not produce one immutable repository digest')
            image = validate_image(candidates[0])
            # Read the pushed manifest from the registry, not just the daemon cache.
            registry = command(['docker', 'buildx', 'imagetools', 'inspect', image, '--raw'],
                               capture=True, env=environment)
            if not isinstance(json.loads(registry), dict):
                raise ValueError('registry did not return an image manifest')
        finally:
            command(['docker', 'logout', 'ghcr.io'], env=environment)
    result = receipt(image, inventory)
    destination.joinpath('image-receipt.json').write_bytes(canonical(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
            stream.write('image=' + image + '\n')
            stream.write('inventory_sha256=' + result['inventory_sha256'] + '\n')
    print(json.dumps(result, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest='operation', required=True)
    for operation in ('build', 'publish'):
        item = subparsers.add_parser(operation)
        item.add_argument('--tag', required=True)
        item.add_argument('--output', required=True, type=Path)
        if operation == 'build':
            item.add_argument('--memory-gib', type=int, choices=range(1, 5), default=4)
    item = subparsers.add_parser('verify')
    item.add_argument('--image', required=True)
    item.add_argument('--output', required=True, type=Path)
    item = subparsers.add_parser('receipt')
    item.add_argument('--image', required=True)
    item.add_argument('--inventory', required=True, type=Path)
    item.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.operation == 'receipt':
        args.output.write_bytes(canonical(receipt(args.image, args.inventory)))
    elif args.operation == 'verify':
        verify(args.image, args.output)
    elif args.operation == 'build':
        build(args.tag, args.output, args.memory_gib)
    else:
        globals()[args.operation](args.tag, args.output)


if __name__ == '__main__':
    main()
