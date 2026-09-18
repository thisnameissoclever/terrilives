"""Export the two-tile tub without scaling it down to fit a one-tile canvas."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
KITCHEN = BASE.parent/'kitchen'
sys.path[:0] = [str(BASE),str(KITCHEN),str(BASE.parent/'furniture')]
from bathtub_model import build
from render_wide_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]),'bathtub',build,
        [Path(__file__),BASE/'bathtub_model.py',BASE/'bathtub_geometry.py',
         KITCHEN/'counter_geometry.py'])
