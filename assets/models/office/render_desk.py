"""Four true rotations using the accepted wide camera and immutable Sim style."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'furniture')]
from render_wide_static import run
from desk_model import build


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass a new absolute candidate directory')
    run(Path(args[0]), 'desk', build,
        [Path(__file__), BASE/'desk_model.py', BASE/'desk_layout.py'])
