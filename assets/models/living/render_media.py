"""Export one media cabinet through the unchanged registered camera."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from render_static import run
from media_model import build


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not Path(args[1]).is_absolute():
        raise ValueError('Pass an object kind and new absolute candidate directory')
    kind = args[0]
    run(Path(args[1]), kind, lambda root: build(root, kind),
        [Path(__file__), BASE/'media_model.py', BASE/'media_layout.py'])
