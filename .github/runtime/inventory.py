"""Install verified upstream archives and record the complete computation runtime."""

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

HOME = Path('/opt/terrilives-mutation-runtime')
RECIPE = HOME / 'recipe'
INVENTORY = HOME / 'inventory.json'
RECIPE_NAMES = ('Dockerfile', 'inputs.lock.json', 'inventory.py', '.dockerignore')
TOOL_NAMES = ('rustc', 'cargo', 'cc', 'c++', 'ld', 'ar', 'readelf', 'ldd',
              'git', 'gh', 'python3', 'bash', 'tar', 'gzip', 'uname',
              'sh', 'as', 'gcc', 'g++', 'cpp', 'dash', 'env', 'sleep', 'mkdir', 'rm')


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def install():
    lock = json.loads((RECIPE / 'inputs.lock.json').read_text())
    with tempfile.TemporaryDirectory(prefix='runtime-install-') as temporary:
        directory = Path(temporary)
        for archive in [*lock['rust_archives'], lock['gh_archive']]:
            path = directory / archive['url'].rsplit('/', 1)[1]
            with urllib.request.urlopen(archive['url'], timeout=120) as response:
                with path.open('wb') as destination:
                    shutil.copyfileobj(response, destination)
            if digest(path) != archive['sha256']:
                raise ValueError(f'upstream archive checksum mismatch: {path.name}')
            with tarfile.open(path) as package:
                package.extractall(directory, filter='data')
            extracted = directory / path.name.removesuffix('.tar.xz').removesuffix('.tar.gz')
            if archive is lock['gh_archive']:
                shutil.copy2(extracted / 'bin/gh', '/usr/local/bin/gh')
            else:
                subprocess.run(['sh', str(extracted / 'install.sh'), '--prefix=/opt/rust',
                                '--disable-ldconfig'], check=True)
            shutil.rmtree(extracted)
            path.unlink()
    assert output('rustc', '--version').startswith('rustc ' + lock['rust_version'] + ' ')
    assert output('gh', '--version').startswith('gh version ' + lock['gh_version'] + ' ')
    output('cargo', 'clippy', '--version')
    output('cargo', 'fmt', '--version')
    assert Path('/opt/rust/lib/rustlib/wasm32-unknown-unknown/lib').is_dir()


def collect():
    tools = {name: str(Path(shutil.which(name)).resolve(strict=True)) for name in TOOL_NAMES}
    aliases = [Path(shutil.which(name)) for name in TOOL_NAMES]
    aliases.extend(Path(name) for name in ('/lib', '/lib64', '/bin', '/sbin'))
    roots = ['/opt/rust', '/usr/lib/x86_64-linux-gnu', '/usr/lib/gcc',
             '/usr/lib/python3.12', '/usr/lib/python3', '/usr/lib/git-core',
             '/usr/include', '/etc/ssl/certs', '/etc/ssl/openssl.cnf',
             '/etc/gitconfig', '/etc/ld.so.conf', '/etc/ld.so.conf.d',
             '/etc/ld.so.cache', '/etc/nsswitch.conf', '/usr/share/ca-certificates']
    paths = set(tools.values())
    for root in roots:
        path = Path(root)
        for member in path.rglob('*') if path.is_dir() else [path]:
            if member.is_symlink():
                aliases.append(member)
            if member.is_file() and '__pycache__' not in member.parts:
                paths.add(str(member.resolve(strict=True)))
    # Cover each ELF interpreter and loaded library, including loader aliases.
    for path in list(paths):
        with open(path, 'rb') as stream:
            elf = stream.read(4) == b'\x7fELF'
        if elf:
            result = subprocess.run(['ldd', path], capture_output=True, text=True)
            for token in result.stdout.split():
                if token.startswith('/') and Path(token).is_file():
                    paths.add(str(Path(token).resolve(strict=True)))
    versions = {name: output('dpkg-query', '-W', '-f=${binary:Package}=${Version}', 'dash')
                if name in ('sh', 'dash') else output(name, '--version')
                for name in TOOL_NAMES}
    versions['packages'] = output('dpkg-query', '-W', '-f=${binary:Package}=${Version}\n')
    return {'version': 1, 'architecture': platform.machine(),
            'files': {path: digest(path) for path in sorted(paths)}, 'tools': tools,
            'symlinks': {str(path): str(path.resolve(strict=True)) for path in aliases
                         if path.is_symlink()},
            'tool_versions': versions,
            'compiler': {'sysroot': output('rustc', '--print', 'sysroot'),
                         'target': 'x86_64-unknown-linux-gnu',
                         'verbose': output('rustc', '-vV')},
            'recipe_inputs': {'.github/runtime/' + name: digest(RECIPE / name)
                              for name in RECIPE_NAMES}}


def verify():
    raw = INVENTORY.read_bytes()
    inventory = json.loads(raw)
    if canonical(inventory) != raw:
        raise ValueError('inventory is not canonical')
    if inventory != collect():
        raise ValueError('installed runtime differs from embedded inventory')
    print(hashlib.sha256(raw).hexdigest())


if __name__ == '__main__':
    if sys.argv[1:] == ['install']:
        install()
    elif sys.argv[1:] == ['record']:
        INVENTORY.write_bytes(canonical(collect()))
    elif sys.argv[1:] == ['verify']:
        verify()
    else:
        raise SystemExit('expected install, record or verify')
