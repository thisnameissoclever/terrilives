"""Reuse the reviewed registration without altering earlier source scripts."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
KITCHEN = BASE.parent/'kitchen'
sys.path[:0] = [str(BASE),str(KITCHEN),str(BASE.parent/'furniture')]
from sink_model import build
from render_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 1 or not Path(arguments[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(arguments[0]),'bathroom-sink',build,
        [Path(__file__),BASE/'sink_model.py',BASE/'basin_geometry.py',
         KITCHEN/'counter_geometry.py'])
