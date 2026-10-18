"""Export the 1 by 1 patio umbrella on the larger registered static prop canvas."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path[:0] = [str(BASE), str(MODELS/'bathroom'), str(MODELS/'kitchen'),
                str(MODELS/'furniture')]
from umbrella_model import build
from render_wide_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]), 'umbrella', build,
        [Path(__file__), BASE/'umbrella_model.py', BASE/'umbrella_layout.py'])
