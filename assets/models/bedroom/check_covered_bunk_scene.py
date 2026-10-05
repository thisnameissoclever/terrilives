"""Check evaluated sleep support, cloth clearance and deliberate detachments."""
import json
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from covered_bunk_sleep import SOURCE, build, digest, set_occupancy


def run(destination):
    if destination.exists():
        raise FileExistsError('Refusing to replace scene evidence')
    if (not bpy.app.background or bpy.app.version_string != '4.5.14 LTS'
            or bpy.app.build_hash.decode() != '62c1db4208e8'):
        raise ValueError('Expected pinned background Blender')
    before = digest(SOURCE)
    result = {'state': 'running', 'source_sha256': before, 'negative_controls': []}
    try:
        from covered_bunk_contact import measure
        state = build()
        result['original'] = measure(state)
        for name, axis, amount, expected in (
                ('Lower mattress', 'z', .1, 'Lost bedding support'),
                ('Lower pillow', 'z', .1, 'Lost bedding support'),
                ('Upper platform', 'z', -.7, 'Body/frame overlap'),
                ('Covered bunk occupied duvet', 'z', -.08, 'Duvet intersects body')):
            obj = bpy.data.objects[name]
            original = getattr(obj.location, axis)
            setattr(obj.location, axis, original + amount)
            try:
                measure(state)
            except (ValueError, AssertionError) as error:
                if not str(error).startswith(expected):
                    raise ValueError('Unexpected control failure: ' + str(error)) from error
                result['negative_controls'].append({'part': name, 'axis': axis,
                                                    'amount': amount, 'failure': str(error)})
            else:
                raise ValueError('Deliberate displacement survived: ' + name)
            finally:
                setattr(obj.location, axis, original)
                bpy.context.view_layer.update()
        result['restored'] = measure(state)
        if result['restored'] != result['original']:
            raise ValueError('Restored geometry differs from the positive control')
        set_occupancy(state, 0)
        set_occupancy(state, 1)
        if measure(state) != result['original']:
            raise ValueError('Occupancy replay changed physical fit')
        if digest(SOURCE) != before:
            raise ValueError('Immutable bunk source changed')
        result['state'] = 'complete'
    except Exception:
        result.update(state='failed', error=traceback.format_exc())
    destination.write_text(json.dumps(result, indent=2) + '\n')
    if result['state'] != 'complete':
        raise RuntimeError(result['error'])


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute scene-proof path')
    run(Path(args[0]))
