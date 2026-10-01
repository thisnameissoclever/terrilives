"""Audit copied model resources and run unchanged contact recipes in Blender."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import traceback


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    import bpy
    request_path = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    directory = request_path.parent
    request = json.loads(request_path.read_text(encoding='utf-8'))
    source = directory / 'source'
    # Exclusive creation prevents a second launch from reusing a job directory.
    report = {'job_id': request['job_id'], 'pid': os.getpid(), 'state': 'running',
        'request_sha256': digest(request_path), 'background': bpy.app.background,
        'engine': [bpy.app.version_string, bpy.app.build_hash.decode()],
        'resources': [], 'outputs': {}}
    with (directory / 'started.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    def verify_copies():
        if digest(request_path) != report['request_sha256']:
            raise ValueError('Replay request changed during execution')
        if digest(Path(__file__)) != request['worker_sha256']:
            raise ValueError('Replay worker changed during execution')
        for name, expected in request['inputs'].items():
            path = (source / name).resolve()
            if not path.is_relative_to(source) or digest(path) != expected:
                raise ValueError(f'Copied input changed: {name}')
    failure = None
    try:
        if not report['background'] or report['engine'] != ['4.5.14 LTS', '62c1db4208e8']:
            raise ValueError('Background mode or pinned Blender build differs')
        verify_copies()
        models = sorted(name for name in request['inputs'] if name.endswith('.blend'))
        if not models:
            raise ValueError('No copied models to audit')
        for name in models:
            bpy.ops.wm.open_mainfile(filepath=str(source / name))
            row = {'model': name, 'required_external_paths': sorted(
                bpy.utils.blend_paths(absolute=True, packed=True, local=False)),
                'all_reference_paths': sorted(
                    bpy.utils.blend_paths(absolute=True, packed=False, local=False)),
                'linked_libraries': len(bpy.data.libraries),
                'packed_images': sum(bool(image.packed_files) for image in bpy.data.images)}
            report['resources'].append(row)
            if row['required_external_paths']:
                raise ValueError(f'Unaccounted external resources: {name}')
        os.environ.pop('PYTHONPATH', None)
        os.chdir(source)
        scripts = ('check-ottoman-sit-candidate-02.py', 'prove-ottoman-occupancy.py')
        for script in scripts:
            with (directory / (script + '.log')).open('x', encoding='utf-8') as log:
                with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                    runpy.run_path(str(source / 'output' / script), run_name='__main__')
            verify_copies()
        base = 'output/ottoman-sit-candidate-02/'
        for name in ('strict-contact-proof-02.json', 'occupancy-regression-proof.json'):
            path = source / base / name
            report['outputs'][base + name] = digest(path)
        report['state'] = 'complete'
    except BaseException as error:
        failure = error
        report.update(state='failed', error=traceback.format_exc())
    finally:
        report['source_bytes_unchanged'] = False
        try:
            verify_copies()
            report['source_bytes_unchanged'] = True
        except Exception:
            report.update(state='failed', source_error=traceback.format_exc())
        temporary = directory / 'result.pending'
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, indent=2) + '\n')
        temporary.rename(directory / 'result.json')
    if failure is not None:
        raise failure


if __name__ == '__main__':
    main()
