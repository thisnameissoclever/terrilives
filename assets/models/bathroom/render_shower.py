"""Export the corner shower through the unchanged registered camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
KITCHEN = BASE.parent/'kitchen'
sys.path[:0] = [str(BASE), str(KITCHEN), str(BASE.parent/'furniture')]
from shower_model import build
from render_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]), 'shower', build,
        [Path(__file__), BASE/'shower_model.py', BASE/'shower_geometry.py',
         KITCHEN/'counter_geometry.py'])
