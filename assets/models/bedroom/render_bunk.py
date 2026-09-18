"""Empty bunk candidates; these do not authorize replacing occupied artwork."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'furniture')]
from bunk_model import build
from render_wide_static import run


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass a new absolute output directory')
    run(Path(args[0]), 'bunk', build,
        [Path(__file__), BASE/'bunk_model.py', BASE/'bunk_layout.py'])
