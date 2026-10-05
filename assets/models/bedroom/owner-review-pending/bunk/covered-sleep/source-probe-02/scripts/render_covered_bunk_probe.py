"""Render immutable source previews after the occupied bunk's physical check."""
import math
import os
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from covered_bunk_sleep import SOURCE, build, digest, set_facing
from covered_bunk_contact import measure
from double_bed_receipt import SnapshotWriter

SCRIPTS = ('covered_bunk_sleep.py', 'bunk_sleep_cloth.py', 'covered_bunk_contact.py',
           'double_bed_sleep.py', 'bunk_contact.py', 'double_bed_receipt.py',
           'double-bed-sleep-pose.json', 'render_covered_bunk_probe.py')


def signature():
    return {'scripts': {name: digest(BASE / name) for name in SCRIPTS},
            'source_sha256': digest(SOURCE), 'blender_version': bpy.app.version_string,
            'blender_build': bpy.app.build_hash.decode(), 'physical_canvas': [1280, 1408]}


def run(output):
    if (not bpy.app.background or bpy.app.version_string != '4.5.14 LTS'
            or bpy.app.build_hash.decode() != '62c1db4208e8'):
        raise ValueError('Expected the pinned background Blender build')
    output.mkdir(parents=True, exist_ok=False)
    writer = SnapshotWriter(output)
    report = {'state': 'running', 'pid': os.getpid(), 'signature': signature(), 'renders': [],
              'acceptance': 'Source probe, not production contribution or runtime acceptance'}
    try:
        writer.publish('start', report)
        state = build()
        report['canonical_fit'] = measure(state)
        writer.publish('canonical-fit', report['canonical_fit'])
        scene = state['scene']
        for covered, facing in ((False, 'SE'), (False, 'SW'),
                                 (True, 'SE'), (True, 'NW'), (True, 'SW'), (True, 'NE')):
            state['blanket'].hide_render = not covered
            for obj in state['root'].children_recursive:
                if obj.name.startswith('Upper'):
                    obj.hide_render = not covered
            set_facing(state, facing)
            path = output / f'{"covered" if covered else "uncovered-diagnostic"}-{facing}.png'
            if path.exists():
                raise FileExistsError('Refusing to replace a source preview')
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            row = {'covered': covered, 'upper_hidden_for_diagnostic': not covered,
                   'facing': facing, 'path': path.name, 'sha256': digest(path)}
            report['renders'].append(row)
            writer.publish('image-result', row)
        if signature() != report['signature']:
            raise ValueError('Frozen source-probe inputs changed')
        report['state'] = 'complete'
        writer.finish(report)
    except Exception:
        report.update(state='failed', error=traceback.format_exc())
        writer.finish(report)
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute source-probe directory')
    run(Path(args[0]))
