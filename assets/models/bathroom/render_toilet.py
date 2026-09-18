"""Export four true rotations through the unchanged registered camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from toilet_model import build
from render_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]), 'toilet', build,
        [Path(__file__), BASE/'toilet_model.py', BASE/'toilet_geometry.py'])
