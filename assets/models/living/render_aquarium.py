"""Render two registered four-facing aquarium batches without altering shared exporters."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from render_static import run
from aquarium_model import build
from check_aquarium_scene import validate


def checked_build(root, frame):
    result = build(root, frame)
    checks = validate()
    return {**result, 'source_checks': checks}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute candidate directory')
    directory = Path(args[0])
    directory.mkdir(parents=True, exist_ok=False)
    for frame in (0, 1):
        run(directory/f'frame-{frame}', f'aquarium-frame-{frame}',
            lambda root: checked_build(root, frame),
            [Path(__file__), BASE/'aquarium_model.py', BASE/'aquarium_layout.py',
             BASE/'check_aquarium_scene.py', BASE/'check_aquarium_visibility.py',
             BASE.parent/'kitchen/check_stove_scene.py', BASE.parent/'bathroom/check_toilet_scene.py'])
