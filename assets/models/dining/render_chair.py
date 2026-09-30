"""Render the dining chair through the unchanged registered four-view camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from render_static import run
from chair_model import build


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass a new absolute candidate directory')
    run(Path(args[0]), 'dining-chair', build,
        [Path(__file__), BASE/'chair_model.py', BASE/'chair_layout.py'])
