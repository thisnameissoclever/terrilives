"""Export either matching cabinet unit without modifying earlier candidates."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE),str(BASE.parent/'furniture')]
from counter_model import build
from render_static import run


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 2 or arguments[0] not in ('counter','sink'):
        raise ValueError('Pass counter or sink and one new absolute output directory after --')
    kind,directory = arguments[0],Path(arguments[1])
    if not directory.is_absolute():
        raise ValueError('Output directory must be absolute')
    run(directory,kind,lambda root:build(root,sink=kind=='sink'),
        [Path(__file__),BASE/'counter_model.py',BASE/'counter_geometry.py'])
