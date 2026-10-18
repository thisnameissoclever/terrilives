"""Export the 2 by 2 pool on the larger registered static prop canvas."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path[:0] = [str(BASE), str(MODELS/'bathroom'), str(MODELS/'kitchen'),
                str(MODELS/'furniture')]
from pool_model import build
from render_wide_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]), 'pool', build,
        [Path(__file__), BASE/'pool_model.py', BASE/'pool_layout.py'])
