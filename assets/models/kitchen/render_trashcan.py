"""Render the static pedal bin with the approved camera and material rig."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'furniture')]
from render_static import run
from trashcan_model import build


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute candidate directory')
    run(Path(args[0]), 'trashcan', build,
        [Path(__file__), BASE/'trashcan_model.py', BASE/'trashcan_layout.py'])
