"""Compare one torso intervention while retaining every collision witness."""
import collections
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import probe_shared_sofa_coupled as coupled

probe = coupled.probe


class Surface:
    def __init__(self, obj, deps):
        self.name = obj.get('probe_source_name', obj.name)
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            self.points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
            self.triangles = [tuple(face.vertices) for face in mesh.loop_triangles]
            edges = collections.defaultdict(list)
            volume = 0.
            for triangle in self.triangles:
                a, b, c = [self.points[index] for index in triangle]
                volume += a.dot(b.cross(c)) / 6.
                for start, end in zip(triangle, (*triangle[1:], triangle[0])):
                    edges[tuple(sorted((start, end)))].append(1 if start < end else -1)
            self.topology = dict(vertices=len(self.points), triangles=len(self.triangles),
                                 boundary_edges=sum(len(uses) == 1 for uses in edges.values()),
                                 nonmanifold_edges=sum(len(uses) > 2 for uses in edges.values()),
                                 inconsistent_edges=sum(len(uses) == 2 and sum(uses) != 0 for uses in edges.values()),
                                 signed_volume=volume)
        finally:
            evaluated.to_mesh_clear()
        self.tree = BVHTree.FromPolygons(self.points, self.triangles, all_triangles=True, epsilon=0)
        self.bounds = [tuple(min(point[axis] for point in self.points) for axis in range(3)),
                       tuple(max(point[axis] for point in self.points) for axis in range(3))]

    def triangle(self, index):
        return [list(self.points[vertex]) for vertex in self.triangles[index]]


def classify(first, second):
    # Preserve the old predicate, with cached bounds and its complete return value.
    low_a, high_a = first.bounds
    low_b, high_b = second.bounds
    if any(high_a[axis] < low_b[axis] or high_b[axis] < low_a[axis] for axis in range(3)):
        return None
    crossings = first.tree.overlap(second.tree)
    if crossings:
        return dict(kind='surface', triangle_pairs=len(crossings),
                    examples=[dict(indices=[a, b], first=first.triangle(a), second=second.triangle(b))
                              for a, b in crossings[:8]])
    for label, source, target in (('first_inside_second', first, second),
                                  ('second_inside_first', second, first)):
        for index, point in enumerate(source.points):
            closest, normal, face, distance = target.tree.find_nearest(point)
            signed = None if closest is None else (point - closest).dot(normal)
            if closest is not None and distance > 1e-6 and signed < -1e-6:
                topology = target.topology
                return dict(kind=label, vertex=index, point=list(point), nearest=list(closest),
                            normal=list(normal), distance=distance, signed_distance=signed,
                            target_triangle=target.triangle(face),
                            containment_prerequisites=(topology['boundary_edges'] == 0
                                and topology['nonmanifold_edges'] == 0
                                and topology['inconsistent_edges'] == 0
                                and topology['signed_volume'] > 0),
                            classification='Unresolved nearest-normal containment inference')
    return None


def prepare(source):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    root = next(obj for obj in bpy.data.objects if obj.type == 'EMPTY' and obj.name.endswith('_MODEL_ROOT'))
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    root.rotation_euler.z = 0
    rig.rotation_euler.z = math.radians(-90)
    scene.frame_set(1)
    rig.animation_data.action = None
    for collection in bpy.data.collections:
        collection.hide_render = False
    furniture_objects = set(root.children_recursive)
    body = bpy.data.collections.new('Witness actor 0')
    furniture = bpy.data.collections.new('Witness furniture')
    scene.collection.children.link(body)
    scene.collection.children.link(furniture)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH', 'CURVE'):
            continue
        obj['probe_source_name'] = obj.name
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        (furniture if obj in furniture_objects else body).objects.link(obj)
    origin = rig.matrix_world.copy()
    second, second_body = probe.clone_owner(rig, body)
    third, third_body = probe.clone_owner(rig, body)
    rigs, bodies = [rig, second, third], [body, second_body, third_body]
    origins = [Matrix.Translation(Vector((0, (index - 1) * .52, 0))) @ origin for index in range(3)]
    return scene, root, rigs, bodies, furniture, origins


def measure(rigs, bodies, furniture):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    solids = {obj.name: Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
    owners = [{obj.get('probe_source_name', obj.name): Surface(obj, deps)
               for obj in body.all_objects if obj.type == 'MESH' and not obj.hide_render} for body in bodies]
    result = dict(collisions=[], own_contacts=[], support=[], surfaces=[])

    def record(a, first_name, b, second_name, first, second, destination):
        collision = classify(first, second)
        if collision:
            result[destination].append(dict(owners=[a, b], parts=[first_name, second_name], evidence=collision))

    for index, owner in enumerate(owners):
        result['surfaces'].append({name: dict(bounds=surface.bounds, **surface.topology) for name, surface in owner.items()})
        try:
            result['support'].append(probe.seat_support(owner['Trouser hip bridge'].points,
                bpy.data.objects[f'Seat cushion {index}'], deps))
        except (ValueError, AssertionError) as error:
            result['support'].append(dict(error=str(error)))
        for name, surface in owner.items():
            for other, solid in solids.items():
                record(index, name, 'furniture', other, surface, solid, 'collisions')
            for neighbour in range(index + 1, 3):
                for other, other_surface in owners[neighbour].items():
                    record(index, name, neighbour, other, surface, other_surface, 'collisions')
        for name in ('Forearm with elbow and wrist sections', 'Forearm with elbow and wrist sections.001'):
            record(index, name, index, 'Overshirt body', owner[name], owner['Overshirt body'], 'collisions')
        # Diagnostic own-contact inventory includes inherited attachments. Nothing is exempted or accepted here.
        torso = ['Overshirt body', 'Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001']
        limbs = [name for name in owner if name.startswith(('Forearm', 'Relaxed palm', 'Resting thumb',
                 'Turned sleeve cuff', 'Reading book'))]
        pairs = {(a, b) for a in limbs for b in torso}
        pairs.add(('Overshirt body', 'Trouser hip bridge'))
        for first_name, second_name in sorted(pairs):
            record(index, first_name, index, second_name, owner[first_name], owner[second_name], 'own_contacts')
    result['frames'] = [{bone.name: dict(matrix=[list(row) for row in bone.matrix], scale=list(bone.scale),
                        head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones} for rig in rigs]
    return result


def run(output, render_images):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    source = probe.MODELS / probe.PROFILES['sofa']['source']
    paths = {source, Path(__file__), Path(coupled.__file__), Path(probe.__file__)}
    for module in list(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).resolve().is_relative_to(probe.MODELS):
            paths.add(Path(path).resolve())
    inputs = {str(path): probe.digest(path) for path in paths}
    proof = dict(state='running', pid=os.getpid(), background=True, blender_version=bpy.app.version_string,
                 inputs=inputs, cases=[], scope='One phase-zero torso comparison; not physical or visual acceptance')
    receipt = output / 'proof.json'

    def save():
        receipt.write_text(json.dumps(proof, indent=2) + '\n')

    save()
    try:
        scene, root, rigs, bodies, furniture, origins = prepare(source)
        for yaw in (0, -30):
            started = time.monotonic()
            root.rotation_euler.z = 0
            coupled.PARAMETERS = (yaw, .08, .18)
            for index, rig in enumerate(rigs):
                rig.matrix_world = origins[index].copy()
                (probe.reading_pose if index == 1 else lambda actor, phase: probe.apply(actor, 'sofa', phase))(rig, 0.)
                coupled.coupled_arms(rig)
            case = dict(yaw=yaw, reach=.08, elbow_x=.18, phase=0., **measure(rigs, bodies, furniture))
            case['geometry_seconds'] = time.monotonic() - started
            proof['cases'].append(case)
            save()
            if render_images:
                root.rotation_euler.z = math.pi
                for index, rig in enumerate(rigs):
                    rig.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ origins[index]
                bpy.context.view_layer.update()
                scene.render.threads_mode = 'FIXED'
                scene.render.threads = 2
                scene.render.resolution_percentage = 100
                scene.render.image_settings.file_format = 'PNG'
                scene.render.image_settings.color_mode = 'RGBA'
                scene.render.film_transparent = True
                image = output / f'NE-yaw-{abs(yaw)}.png'
                collections = dict(furniture=furniture, **{f'sim{i}': body for i, body in enumerate(bodies)})
                case['render_seconds'] = probe.render(scene, collections, 'beauty', image)
                case['image'] = dict(path=image.name, sha256=probe.digest(image))
                save()
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A diagnostic input changed while running')
        proof['state'] = 'complete'
    except BaseException as error:
        proof['state'] = 'failed'
        proof['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:]
    run(Path(arguments[0]), '--render' in arguments[1:])
