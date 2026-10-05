"""Editable solid doors, four orientations, registered colour and surface depth."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
SIM = BASE.parent / 'sims/sim-01'
sys.path.insert(0, str(BASE.parent))
from architecture_dimensions import WALL_AND_DOOR_DEPTH
sys.path.insert(0, str(BASE.parent / 'furniture'))
from build_parts import box, cylinder, material, mesh

WIDTH, HEIGHT, DENSITY = 112, 120, 3
PIXELS_PER_UNIT = 32 * math.sqrt(2)
ELEVATION = math.asin(21 / 32)
Z_SCALE = 38 / (PIXELS_PER_UNIT * math.cos(ELEVATION))


def point(x, y, z):
    return (x, -y, z * Z_SCALE)


def part(name, center, size, mat, root, bevel=.006):
    return box(name, point(*center), (size[0], size[1], size[2] * Z_SCALE), mat, root, bevel)


def build():
    scene = bpy.context.scene
    hidden = bpy.data.collections.new('Preserved character reference')
    scene.collection.children.link(hidden)
    for obj in list(bpy.data.objects):
        if obj.type in ('MESH', 'CURVE'):
            for collection in list(obj.users_collection):
                collection.objects.unlink(obj)
            hidden.objects.link(obj)
    hidden.hide_render = True
    root = bpy.data.objects.new('DOOR_MODEL', None)
    scene.collection.objects.link(root)
    leaf = bpy.data.objects.new('HINGED_LEAF', None)
    scene.collection.objects.link(leaf)
    leaf.parent = root
    leaf.location = point(.5 - WALL_AND_DOOR_DEPTH/2 + .035, -.365, 0)
    frame = bpy.data.objects.new('FIXED_CASING', None)
    scene.collection.objects.link(frame)
    frame.parent = root
    casing = material('Warm painted casing', (.52, .49, .43))
    wood = material('Door oak', (.37, .235, .13))
    inset = material('Recessed oak panels', (.34, .207, .11))
    metal = material('Brushed brass hardware', (.49, .37, .16))
    stone = material('Flush threshold', (.39, .37, .33))
    profile = [(-.5, 0), (-.5, 2), (.5, 2), (.5, 0),
               (.39, 0), (.39, 1.8), (-.39, 1.8), (-.39, 0)]
    vertices = [point(x, y, z) for x in (.5-WALL_AND_DOOR_DEPTH/2, .5+WALL_AND_DOOR_DEPTH/2) for y, z in profile]
    faces = [tuple(reversed(range(8))), tuple(range(8, 16))]
    faces += [(i, (i + 1) % 8, (i + 1) % 8 + 8, i + 8) for i in range(8)]
    casing_mesh = mesh('Continuous joined casing', vertices, faces, casing, frame)
    bevel = casing_mesh.modifiers.new('Soft painted edge', 'BEVEL')
    bevel.width, bevel.segments = .006, 3
    casing_mesh.modifiers.new('Weighted casing normals', 'WEIGHTED_NORMAL')
    # The threshold is a floor surface, not a raised strip across the feet.
    sill = part('Flush floor threshold', (.5, 0, -.003), (WALL_AND_DOOR_DEPTH, .78, .006), stone, frame, 0)
    sill['floor_surface'] = True
    part('Solid door slab', (0, .365, .905), (.075, .73, 1.76), wood, leaf)
    for side in (-1, 1):
        for z, height in ((.445, .58), (1.315, .64)):
            part('Recessed panel', (side * .038, .365, z), (.008, .54, height), inset, leaf, .012)
            # A single rim avoids little contour knots at four box joints.
            corners = [(y, zz) for y, zz in ((.073, z-height/2-.026), (.657, z-height/2-.026),
                (.657, z+height/2+.026), (.073, z+height/2+.026), (.097, z-height/2),
                (.633, z-height/2), (.633, z+height/2), (.097, z+height/2))]
            rim = mesh('Continuous panel moulding', [point(side*.049, y, zz) for y, zz in corners],
                [(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], wood, leaf)
            solid = rim.modifiers.new('Moulding thickness', 'SOLIDIFY')
            solid.thickness = .006
        cylinder('Handle rose', point(side * .039, .635, .89), point(side * .054, .635, .89), .033, metal, leaf)
        cylinder('Handle spindle', point(side * .047, .635, .89), point(side * .092, .635, .89), .011, metal, leaf)
        cylinder('Lever handle', point(side * .091, .635, .89), point(side * .091, .535, .89), .012, metal, leaf)
    for z in (.30, .90, 1.50):
        cylinder('Hinge barrel', point(0, 0, z - .043), point(0, 0, z + .043), .019, metal, leaf)
    return root, frame, leaf


def depth_image(scene, objects, output):
    """Ray-cast the evaluated model through the exact orthographic camera."""
    graph = bpy.context.evaluated_depsgraph_get()
    vertices, triangles, floor_flags = [], [], []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        start = len(vertices)
        vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        triangles.extend(tuple(start + i for i in t.vertices) for t in mesh.loop_triangles)
        floor_flags.extend([bool(obj.get('floor_surface'))] * len(mesh.loop_triangles))
        evaluated.to_mesh_clear()
    tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
    w, h = WIDTH * DENSITY, HEIGHT * DENSITY
    camera = scene.camera.matrix_world
    right, up = camera.to_3x3() @ Vector((1, 0, 0)), camera.to_3x3() @ Vector((0, 1, 0))
    direction = camera.to_3x3() @ Vector((0, 0, -1))
    origin = camera.translation
    data = np.zeros((h, w, 4), dtype=np.float32)
    unit = 1 / (PIXELS_PER_UNIT * DENSITY)
    for row in range(h):
        base = origin + up * ((h / 2 - row - .5) * unit)
        for col in range(w):
            hit, _, face, _ = tree.ray_cast(base + right * ((col + .5 - w / 2) * unit), direction)
            if hit is not None:
                # Game X+Y = Blender X-Y. Two channels retain subpixel depth.
                encoded = round((hit.x - hit.y + 2) / 4 * 65535)
                assert 0 <= encoded <= 65535
                data[row, col] = (encoded // 256 / 255, encoded % 256 / 255, float(floor_flags[face]), 1)
    # Contour/filter pixels extend a few texels beyond the solid. Give those
    # texels the nearest surface without expanding colour coverage.
    for _ in range(4):
        previous = data.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted = np.roll(previous, (dy, dx), (0, 1))
            use = (data[:, :, 3] == 0) & (shifted[:, :, 3] > 0)
            data[use] = shifted[use]
    np.save(output, data)


def run():
    assert bpy.app.background
    args = sys.argv[sys.argv.index('--') + 1:]
    output = Path(args[0]).resolve()
    assert not (output / 'manifest.json').exists(), 'Never overwrite an existing door candidate'
    output.mkdir(parents=True, exist_ok=True)
    inputs = [Path(__file__), BASE.parent/'furniture/build_parts.py',
              BASE.parent/'furniture/geometry.py', SIM/'sim-01-rigged.blend',
              BASE.parent/'architecture_dimensions.py', BASE.parent/'architecture-depth.json']
    hashes = {path.relative_to(BASE.parent).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    bpy.ops.wm.open_mainfile(filepath=str(SIM / 'sim-01-rigged.blend'))
    root, frame, leaf = build()
    casing_mesh = next(obj for obj in frame.children_recursive if obj.name.startswith('Continuous joined casing'))
    casing_faces = [min(v.co.x for v in casing_mesh.data.vertices), max(v.co.x for v in casing_mesh.data.vertices)]
    assert abs(casing_faces[1]-casing_faces[0]-WALL_AND_DOOR_DEPTH) < 1e-6
    scene = bpy.context.scene
    # The character reference's 4 px ink is too heavy at this smaller canvas.
    # Match the thin brown contour of the room's furniture and wall art.
    for layer in scene.view_layers:
        for lines in layer.freestyle_settings.linesets:
            lines.linestyle.thickness = 1.4
            lines.linestyle.color = (.075, .061, .046)
    # The authoring file keeps the door, camera and lights. The immutable
    # character scene remains an external style reference recorded by hash.
    hidden = bpy.data.collections['Preserved character reference']
    for obj in list(hidden.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(hidden)
    bpy.data.orphans_purge(do_recursive=True)
    scene.render.resolution_x, scene.render.resolution_y = WIDTH * DENSITY, HEIGHT * DENSITY
    scene.render.resolution_percentage = 100
    scene.render.threads_mode, scene.render.threads = 'FIXED', 2
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.camera.data.type = 'ORTHO'
    scene.camera.data.ortho_scale = HEIGHT / PIXELS_PER_UNIT
    target = Vector((0, 0, (HEIGHT / 2 - 21) / (PIXELS_PER_UNIT * math.cos(ELEVATION))))
    view = Vector((math.cos(ELEVATION) / math.sqrt(2), -math.cos(ELEVATION) / math.sqrt(2), math.sin(ELEVATION)))
    scene.camera.location = target + view * 12
    scene.camera.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'doors.blend'))
    records = []
    limit = int(args[1]) if len(args) > 1 else 40
    for facing in range(4):
        root.rotation_euler.z = -facing * math.pi / 2
        for phase in range(-1, 9):
            name = f'doorFrame{facing}' if phase < 0 else f'doorLeaf{facing}_{phase}'
            for obj in frame.children_recursive: obj.hide_render = phase >= 0
            for obj in leaf.children_recursive: obj.hide_render = phase < 0
            leaf.rotation_euler.z = -max(0, phase) / 8 * math.pi / 2
            bpy.context.view_layer.update()
            scene.render.filepath = str(output / f'{name}.png')
            bpy.ops.render.render(write_still=True)
            depth_image(scene, frame.children_recursive if phase < 0 else leaf.children_recursive, output / f'{name}-depth.npy')
            records.append({'name': name, 'facing': facing, 'phase': phase})
            (output / 'manifest.json').write_text(json.dumps({'records': records, 'density': DENSITY,
                'canvas': [WIDTH, HEIGHT], 'inputs': hashes, 'authoredDimensions': {
                    'casingDepth': WALL_AND_DOOR_DEPTH, 'measuredMeshFaces': casing_faces,
                    'measuredMeshDepth': casing_faces[1]-casing_faces[0], 'casingFaces': [.5-WALL_AND_DOOR_DEPTH/2,.5+WALL_AND_DOOR_DEPTH/2],
                    'leafHingeX': leaf.location.x, 'leafFrontSeating': .035,
                    'openingWidth': .78, 'openingHeight': 1.8, 'slabWidth': .73,
                    'thresholdDepth': WALL_AND_DOOR_DEPTH, 'thresholdFloor': True}}, indent=2))
            if len(records) >= limit:
                assert hashes == {path.relative_to(BASE.parent).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
                return
    assert hashes == {path.relative_to(BASE.parent).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}


if __name__ == '__main__':
    output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    assert not (output / 'manifest.json').exists(), 'Never overwrite an existing door candidate'
    assert not (output / 'status.json').exists(), 'Never overwrite an existing door receipt'
    status_path = output / 'status.json'
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status = {'state': 'running', 'background': bpy.app.background, 'version': bpy.app.version_string}
    status_path.write_text(json.dumps(status))
    try:
        run()
        status['state'] = 'complete'
    except Exception:
        status.update(state='failed', error=traceback.format_exc())
        raise
    finally:
        status_path.write_text(json.dumps(status, indent=2))
