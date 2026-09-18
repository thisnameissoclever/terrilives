"""Render the laundry stack through the existing registered camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
KITCHEN = BASE.parent/'kitchen'
sys.path[:0] = [str(BASE), str(KITCHEN), str(BASE.parent/'furniture')]
from laundry_model import build
from render_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]), 'laundry', build,
        [Path(__file__), BASE/'laundry_model.py', BASE/'laundry_geometry.py'])
