"""Evaluate pool surfaces and render each facing on the registered Sim camera."""
import hashlib
import json
import math
import random
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

from pool_activity_model_v8 import replace_mesh
from geometry import FACINGS
from pool_activity_layout_v9 import corners

MODELS = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def ripple_surface(obj, bounds, height, columns, rows):
    # Keep reflections in one planar surface. The color and depth exporters
    # see the same waterline without interior outline strokes or floating decals.
    randomizer = random.Random(7234)
    vertices = [Vector((x, y)) for x, y, _ in corners(bounds, height)]
    faces = [tuple(range(4))]
    for row in range(rows):
        for column in range(columns):
            x = bounds[0] + (column + randomizer.uniform(.15, .58)) * (bounds[1]-bounds[0])/columns
            y = bounds[2] + (row + randomizer.uniform(.2, .8)) * (bounds[3]-bounds[2])/rows
            length = randomizer.uniform(.075, .19)
            start = len(vertices)
            vertices.extend(Vector((x + a*length, y + b)) for a, b in
                            ((0, 0), (.37, .015), (.7, .008), (1, .019),
                             (.72, -.003), (.36, .003)))
            faces.append(tuple(reversed(range(start, len(vertices)))))
    points, _, triangles, _, _, owners = delaunay_2d_cdt(vertices, [], faces, 1, .000001)
    replace_mesh(obj, [(p.x, p.y, height) for p in points], triangles,
                 [int(any(index > 0 for index in parents)) for parents in owners])


def add_ground_holdout(scene, root, opening):
    # Below-grade faces may only be seen through the hole in the grass.
    collection = bpy.data.collections.new('Ground above the excavated basin')
    scene.collection.children.link(collection)
    vertices = corners((-15,15,-15,15), -.007) + corners(opening, -.007)
    faces = [(i, (i+1)%4, 4+(i+1)%4, 4+i) for i in range(4)]
    data = bpy.data.meshes.new('Ground aperture')
    data.from_pydata(vertices,[],faces)
    data.update()
    obj = bpy.data.objects.new(data.name,data)
    collection.objects.link(obj)
    obj.parent = root
    bpy.context.view_layer.layer_collection.children[collection.name].holdout = True


def evaluated(root):
    graph = bpy.context.evaluated_depsgraph_get()
    solids = []
    for obj in sorted(root.children_recursive, key=lambda child: child.name):
        if obj.type != 'MESH' or obj.name == 'Pool water surface':
            continue
        current = obj.evaluated_get(graph)
        source = current.to_mesh()
        try:
            transform = root.matrix_world.inverted() @ current.matrix_world
            vertices = [list(transform @ vertex.co) for vertex in source.vertices]
            source.calc_loop_triangles()
            bounds = [[op(v[i] for v in vertices) for i in range(3)] for op in (min,max)]
            solids.append(dict(id=obj.name, kind='floor' if obj.name == 'Pool basin floor' else 'solid',
                               vertices=vertices, triangles=[list(t.vertices) for t in source.loop_triangles],
                               bounds=bounds))
        finally:
            current.to_mesh_clear()
    return solids


def render(out, root, model, inputs, *, canvas, footprint, origin_xy, water_z, cutaway=None):
    density = 8
    scene, = [s for s in bpy.data.scenes if s.camera]
    bpy.context.window.scene = scene
    hidden = bpy.data.collections.new('Preserved Sim reference - hidden')
    scene.collection.children.link(hidden)
    for obj in list(scene.objects):
        if obj.type in ('MESH','CURVE'):
            for coll in list(obj.users_collection):
                coll.objects.unlink(obj)
            hidden.objects.link(obj)
    hidden.hide_render = True
    for obj in [root,*root.children_recursive]:
        scene.collection.objects.link(obj)
    if cutaway:
        add_ground_holdout(scene, root, cutaway)
    registration = MODELS/'sims/sim-01/registered-canvas-proof.json'
    camera = json.loads(registration.read_bytes())['idle']
    scene.render.resolution_x,scene.render.resolution_y = (v*density for v in canvas)
    scene.render.resolution_percentage = 100
    scene.camera.data.ortho_scale = camera['camera_ortho_scale']*max(canvas)/88
    scene.camera.location = camera['camera_location']
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 1
    bpy.context.view_layer.update()
    p = world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
    origin = [p.x*scene.render.resolution_x,(1-p.y)*scene.render.resolution_y]
    if any(abs(a-b)>.01 for a,b in zip(origin,(canvas[0]*4,canvas[1]*4+280.0035))):
        raise ValueError(f'Unregistered camera {origin}')
    inputs = [*inputs, Path(__file__), registration]
    proof = dict(state='rendering',object='pool',inputs={p.relative_to(MODELS).as_posix():sha(p) for p in inputs},
                 logical_canvas=canvas,source_density=density,origin_pixels=origin,
                 camera_matrix=[list(v) for v in scene.camera.matrix_world],ortho_scale=scene.camera.data.ortho_scale,
                 model_sha256=sha(model),geometry_sha256=sha(out/'geometry.json'),blender_version=bpy.app.version_string,
                 model_checks=dict(footprint=footprint,origin=origin_xy,water_z=water_z),renders=[])
    for facing,degrees in FACINGS.items():
        root.rotation_euler.z = math.radians(degrees)
        root.location = root.rotation_euler.to_matrix() @ Vector((-origin_xy[0],-origin_xy[1],0))
        path = out/f'closed-{facing}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        proof['renders'].append(dict(facing=facing,degrees=degrees,path=path.name,sha256=sha(path)))
    proof['state']='complete'
    (out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf8')
