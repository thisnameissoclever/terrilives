"""Re-render the existing fridge at room-relative scale without camera changes."""
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'furniture')]
from fridge_geometry import door_point
from fridge_model import build as build_original
from render_static import run


def build(root):
    hinges = build_original(root)
    root.scale = (1.2, 1.2, 1.2)
    for hinge in hinges:
        for degrees in (0, 45, 90):
            import math
            hinge.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            actual = hinge.matrix_world @ Vector((-.60, -.07, .70))
            expected = root.matrix_world @ Vector(door_point((-.60, -.07, .70), degrees))
            assert (actual-expected).length < 1e-6, 'Scaled hinge changed'
        hinge.rotation_euler.z = 0
    bpy.context.view_layer.update()
    return {'uniform_model_scale': 1.2, 'front': '-Y',
            'closed_height_m': 1.944, 'case_width_m': .912,
            'hinge_angles_checked': [0, 45, 90],
            'runtime_footprint_tiles': [1, 1],
            'front_hardware_overhang': 'extends beyond the occupied tile'}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute output directory after --')
    run(Path(args[0]), 'refrigerator', build,
        [Path(__file__), BASE/'fridge_model.py', BASE/'fridge_geometry.py'])
