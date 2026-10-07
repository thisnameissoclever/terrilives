"""Source-preserving mixed-seat experiment; output is not an accepted asset."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / 'assets/models'
for name in ('seating', 'living', 'bedroom', 'furniture', 'sims/sim-01'):
    sys.path.insert(0, str(MODELS / name))
from pose_profiles import PROFILES
from neutral_pose import apply
from build_rig import pose, direct_bone, arm_elbow
from double_bed_sleep import clone_owner
from armchair_contact import evaluated_surface, intersection, seat_support


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reading_pose(rig, phase):
    pose(rig, 'read', phase)
    profile = PROFILES['sofa']
    shift = Vector((0, profile['hip_y'], profile['z_offset'])) - Vector((0, -.06, -.33))
    names = ['spine', 'head', 'book'] + [
        part + '.' + side for side in ('L', 'R') for part in ('upper_arm', 'forearm', 'hand')]
    endpoints = {name: (rig.pose.bones[name].head.copy() + shift,
                        rig.pose.bones[name].tail.copy() + shift) for name in names}
    apply(rig, 'sofa', phase)
    for name in names:
        direct_bone(rig, name, *endpoints[name])
    rig['book_visible'] = 1.0
    rig['eyes_closed'] = 0.0
    bpy.context.view_layer.update()


def render(scene, collections, owner, path):
    layer = bpy.context.view_layer
    for name, collection in collections.items():
        layer.layer_collection.children[collection.name].holdout = owner in collections and owner != name
    for lines in layer.freestyle_settings.linesets:
        lines.select_by_collection = False
    scene.render.use_freestyle = owner in ('beauty', 'lines')
    layer.freestyle_settings.as_render_pass = owner == 'lines'
    scene.use_nodes = owner == 'lines'
    if owner == 'lines':
        nodes = scene.node_tree
        nodes.nodes.clear()
        source = nodes.nodes.new('CompositorNodeRLayers')
        output = nodes.nodes.new('CompositorNodeComposite')
        nodes.links.new(source.outputs['Freestyle'], output.inputs['Image'])
    scene.render.filepath = str(path)
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    return time.monotonic() - started


def tuck_arms(rig):
    for side, sign in (('L', -1), ('R', 1)):
        shoulder = rig.pose.bones['upper_arm.' + side].head.copy()
        wrist = rig.pose.bones['hand.' + side].head.copy()
        hand_end = rig.pose.bones['hand.' + side].tail.copy()
        pole = Vector((sign * .15, min(shoulder.y, wrist.y) - .12,
                       min(shoulder.z, wrist.z) - .30))
        elbow = arm_elbow(shoulder, wrist, rig.data.bones['upper_arm.' + side].length,
                          rig.data.bones['forearm.' + side].length, pole)
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, hand_end)
    bpy.context.view_layer.update()


def run(output, render_images):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and an absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    source = MODELS / PROFILES['sofa']['source']
    inputs = {source: digest(source), Path(__file__): digest(Path(__file__))}
    for module in list(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).resolve().is_relative_to(MODELS):
            path = Path(path).resolve()
            inputs[path] = digest(path)
    report = dict(state='running', pid=os.getpid(), background=bpy.app.background,
                  blender_version=bpy.app.version_string, contacts=[], renders=[],
                  inputs={str(p): sha for p, sha in inputs.items()})
    receipt = output / 'proof.json'
    def save():
        receipt.write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
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
        body = bpy.data.collections.new('Probe sofa actor 0')
        furniture = bpy.data.collections.new('Probe sofa furniture')
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
        second, second_body = clone_owner(rig, body)
        third, third_body = clone_owner(rig, body)
        rigs, bodies = [rig, second, third], [body, second_body, third_body]
        origins = []
        for index, actor in enumerate(rigs):
            actor.matrix_world = Matrix.Translation(Vector((0, (index-1)*.52, 0))) @ origin
            bodies[index].name = f'Probe sofa actor {index}'
            origins.append(actor.matrix_world.copy())
        for phase in (0., .25, .5, .75):
            for index, actor in enumerate(rigs):
                actor.matrix_world = origins[index].copy()
                (reading_pose if index == 1 else lambda r, p: apply(r, 'sofa', p))(actor, phase)
                tuck_arms(actor)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            solids = {obj.name: evaluated_surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
            owners = [{obj.get('probe_source_name', obj.name): evaluated_surface(obj, deps)
                       for obj in collection.all_objects if obj.type == 'MESH' and not obj.hide_render}
                      for collection in bodies]
            collisions, support = [], []
            for index, owner in enumerate(owners):
                for name, surface in owner.items():
                    for other, solid in solids.items():
                        if intersection(surface, solid):
                            collisions.append([index, name, 'furniture', other])
                try:
                    support.append(seat_support(owner['Trouser hip bridge'][0], bpy.data.objects[f'Seat cushion {index}'], deps))
                except (AssertionError, ValueError) as error:
                    support.append(dict(error=str(error)))
                for name in ('Forearm with elbow and wrist sections', 'Forearm with elbow and wrist sections.001'):
                    if intersection(owner[name], owner['Overshirt body']):
                        collisions.append([index, name, index, 'Overshirt body'])
                for next_index in range(index+1, 3):
                    for name, surface in owner.items():
                        for other, other_surface in owners[next_index].items():
                            if intersection(surface, other_surface):
                                collisions.append([index, name, next_index, other])
            report['contacts'].append(dict(phase=phase, collisions=collisions, support=support,
                                           visible=[sorted(owner) for owner in owners]))
            save()
        for index, actor in enumerate(rigs):
            actor.matrix_world = origins[index].copy()
            (reading_pose if index == 1 else lambda r, p: apply(r, 'sofa', p))(actor, 0.)
            tuck_arms(actor)
            actor.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ origins[index]
        root.rotation_euler.z = math.pi
        bpy.context.view_layer.update()
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'probe.blend'))
        if render_images:
            collections = dict(furniture=furniture, **{f'sim{i}': b for i, b in enumerate(bodies)})
            for owner in ('beauty', 'furniture', 'sim0', 'sim1', 'sim2', 'lines'):
                path = output / f'NE-{owner}.png'
                elapsed = render(scene, collections, owner, path)
                report['renders'].append(dict(owner=owner, seconds=elapsed, path=path.name, sha256=digest(path)))
                save()
        if any(digest(path) != sha for path, sha in inputs.items()):
            raise ValueError('Probe changed a source input')
        report['state'] = 'complete'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    run(Path(args[0]), '--render' in args[1:])
