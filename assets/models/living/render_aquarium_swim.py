"""Render the swimming loop without changing the accepted two-pose sources."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen'), str(BASE.parent/'furniture')]
from mathutils import Matrix
import bpy
from aquarium_model import build
from aquarium_swim import motion, SAMPLE_COUNT
from check_aquarium_scene import validate
from render_static import run


def swimming_build(root, frame):
    result = build(root, 0)
    for movement in motion(frame):
        name = movement['name']
        dx, dy, dz = movement['translation']
        translation = Matrix.Translation((dy, -dx, dz))
        for suffix in (' body', ' tail', ' eye -1', ' eye 1'):
            obj = bpy.data.objects[name+suffix]
            obj.matrix_world = translation @ obj.matrix_world
        tail = bpy.data.objects[name+' tail']
        for index in (1, 2, 4, 5):
            tail.data.vertices[index].co.y += movement['tail_shift']
    bpy.context.view_layer.update()
    return {**result, 'fish_frame': frame, 'sample_count': SAMPLE_COUNT,
            'motion': motion(frame), 'source_checks': validate()}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass a new absolute swimming candidate directory')
    directory = Path(args[0])
    directory.mkdir(parents=True, exist_ok=False)
    sources = [Path(__file__), BASE/'aquarium_swim.py', BASE/'aquarium_model.py',
               BASE/'aquarium_layout.py', BASE/'check_aquarium_scene.py',
               BASE/'check_aquarium_visibility.py',
               BASE.parent/'kitchen/check_stove_scene.py',
               BASE.parent/'bathroom/check_toilet_scene.py']
    for frame in range(SAMPLE_COUNT):
        run(directory/f'frame-{frame}', f'aquarium-swim-{frame}',
            lambda root: swimming_build(root, frame), sources)
