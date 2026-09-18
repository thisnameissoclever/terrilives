"""Render one closed bedroom cabinet through the registered camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from render_static import run
from storage_model import build


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or args[0] not in ('nightstand', 'dresser') or not Path(args[1]).is_absolute():
        raise ValueError('Pass nightstand or dresser and a new absolute output directory')
    kind, directory = args
    run(Path(directory), kind, lambda root: build(root, kind),
        [Path(__file__), BASE/'storage_model.py', BASE/'storage_layout.py'])
