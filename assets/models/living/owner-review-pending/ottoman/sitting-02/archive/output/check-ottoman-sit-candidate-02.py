"""Strict offline contact check for the separate ottoman action."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import traceback

import bpy
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT/'output'), str(ROOT/'assets/models/living')]
from armchair_support import contact_footprint
from surface_volume import ClosedSurface, boundary_edges, cap_planar_loop

DIRECTORY = ROOT/'output/ottoman-sit-candidate-02'
MODEL = DIRECTORY/'ottoman-sit-authoring.blend'
AUTHOR = ROOT/'output/build-ottoman-sit-refined.py'
spec = importlib.util.spec_from_file_location('ottoman_candidate_refined', AUTHOR)
author = importlib.util.module_from_spec(spec)
spec.loader.exec_module(author)
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
SOURCE_NECK = None


class Surface:
    def __init__(self, obj, deps):
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            self.points = [tuple(evaluated.matrix_world @ vertex.co) for vertex in mesh.vertices]
            self.triangles = [tuple(face.vertices) for face in mesh.loop_triangles]
        finally:
            evaluated.to_mesh_clear()
        self.low = [min(p[i] for p in self.points) for i in range(3)]
        self.high = [max(p[i] for p in self.points) for i in range(3)]
        self.tree = BVHTree.FromPolygons(self.points, self.triangles, all_triangles=True, epsilon=0)
        self.name = obj.name
        self._volume = None
        self.volume_tree = None
        self.analysis_cap_faces = 0

    def volume(self):
        if self._volume is None:
            try:
                points, triangles = self.points, self.triangles
                if self.name == 'Overshirt body':
                    assert SOURCE_NECK is not None, 'Original neck boundary was not verified'
                    boundary = {tuple(sorted(edge)) for edge in boundary_edges(triangles)}
                    assert boundary == SOURCE_NECK['edges'], 'Approved neck topology changed'
                    vertices = sorted({i for edge in boundary for i in edge})
                    for index, first in enumerate(vertices):
                        for second in vertices[index+1:]:
                            before = math.dist(SOURCE_NECK['points'][first], SOURCE_NECK['points'][second])
                            after = math.dist(points[first], points[second])
                            assert abs(after-before) < 1e-5, 'Approved neck dimensions changed'
                    points, triangles = cap_planar_loop(points, triangles, boundary)
                    self.analysis_cap_faces = len(triangles)-len(self.triangles)
                self._volume = ClosedSurface(points, triangles)
                self.volume_tree = BVHTree.FromPolygons(points, triangles, all_triangles=True, epsilon=0)
                self._volume.validate_self_intersections(self.volume_tree.overlap(self.volume_tree))
            except ValueError as error:
                raise ValueError(f'{self.name}: {error}') from error
        return self._volume


def collision(a, b):
    if any(a.high[i] < b.low[i] or b.high[i] < a.low[i] for i in range(3)):
        return None
    crossing = a.tree.overlap(b.tree)
    if crossing:
        return {'kind': 'surface', 'triangle_pairs': len(crossing)}
    first, second = a.volume(), b.volume()
    envelope_crossing = a.volume_tree.overlap(b.volume_tree)
    if envelope_crossing:
        return {'kind': 'analysis_envelope_intrusion', 'triangle_pairs': len(envelope_crossing)}
    for left, right, label in ((first, second, 'first_inside_second'),
                               (second, first, 'second_inside_first')):
        inside = left.enclosed_components(right)
        if inside:
            return {'kind': label, 'components': inside}
    return None


def check_frame(scene, rig, root, body, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    assert rig.animation_data.action.name == 'ottoman_sit', 'Wrong target-specific action'
    assert rig.location.length < 1e-6 and root.location.length < 1e-6, 'Registered origin shifted'
    assert max(abs(v) for v in root.rotation_euler) < 1e-6, 'Furniture basis changed'
    assert abs(rig.rotation_euler.z + math.pi/2) < 1e-6, 'Body basis changed'
    root_pose, root_rest = rig.pose.bones['root'].matrix, rig.data.bones['root'].matrix_local
    assert max(abs(root_pose[i][j]-root_rest[i][j]) for i in range(4) for j in range(4)) < 1e-6, 'Root pose changed'
    deps = bpy.context.evaluated_depsgraph_get()
    objects = {obj.name: obj for obj in body.all_objects if not obj.hide_render}
    assert set(objects) == author.body_inventory(), 'Visible body inventory changed'
    assert all(obj.type == 'MESH' for obj in objects.values()), 'Unsupported body geometry'
    surfaces = {name: Surface(obj, deps) for name, obj in objects.items()}
    furniture = {obj.name: Surface(obj, deps) for obj in root.children_recursive}
    assert len(furniture) == 8 and all(not obj.hide_render for obj in root.children_recursive)
    for name, first in surfaces.items():
        for other, second in furniture.items():
            result = collision(first, second)
            assert result is None, f'Body/furniture collision: {name} / {other} / {result}'
    hands = ('Relaxed palm', 'Relaxed palm.001', 'Resting thumb', 'Resting thumb.001')
    legs = ('Tailored trouser leg', 'Tailored trouser leg.001')
    pairs = [(hand, leg) for hand in hands for leg in legs]
    pairs += [(name, 'Overshirt body') for name in
              ('Forearm with elbow and wrist sections', 'Forearm with elbow and wrist sections.001')]
    pairs += [('Shaped shoe', 'Shaped shoe.001'),
              ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001')]
    for name, other in pairs:
        result = collision(surfaces[name], surfaces[other])
        assert result is None, f'Body self-collision: {name} / {other} / {result}'
    from mathutils import Vector
    support = author.seat_support([Vector(point) for point in surfaces['Trouser hip bridge'].points],
                                  bpy.data.objects['Cushion'], deps)
    bone_errors = {bone.name: abs(bone.length-rig.data.bones[bone.name].length) for bone in rig.pose.bones}
    assert max(bone_errors.values()) < 1e-5, 'Pose stretched a bone'
    assert all(abs(v-1) < 1e-5 for bone in rig.pose.bones for v in bone.scale), 'Pose scaled a body part'
    for side in ('L', 'R'):
        for parent, child in (('thigh.', 'shin.'), ('shin.', 'foot.'),
                              ('upper_arm.', 'forearm.'), ('forearm.', 'hand.')):
            assert (rig.pose.bones[parent+side].tail-rig.pose.bones[child+side].head).length < 1e-5, 'Disconnected joint'
    floor = {}
    for name in ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'):
        surface = surfaces[name]
        assert 0 <= surface.low[2] <= .001, f'Sole lost floor proximity: {name}'
        near = [point for point in surface.points if 0 <= point[2] <= .003]
        floor[name] = {'point_count': len(near), 'gap_limit': .003, **contact_footprint(near)}
    return {'frame': frame, 'hip_support': support, 'maximum_bone_length_error': max(bone_errors.values()),
            'body_pairs_checked': len(pairs), 'body_furniture_intersections': [], 'body_self_intersections': [],
            'floor_support': floor, 'validated_volumes': sorted(
                name for name, surface in {**surfaces, **furniture}.items() if surface._volume),
            'analysis_only_caps': {name: surface.analysis_cap_faces for name, surface in surfaces.items()
                                   if surface.analysis_cap_faces}}


def main():
    global SOURCE_NECK
    assert bpy.app.background
    saved = json.loads((DIRECTORY/'status.json').read_text())
    assert saved['state'] == 'complete' and saved['fit_passed']
    assert digest(MODEL) == saved['candidate_sha256']
    for name, expected in saved['source_hashes'].items():
        assert digest(ROOT/name) == expected, f'Changed source: {name}'
    inputs = {str(path.relative_to(ROOT)): digest(path) for path in
              (MODEL, AUTHOR, Path(__file__), ROOT/'output/surface_volume.py')}
    proof = {'state': 'running', 'pid': os.getpid(), 'background': bpy.app.background,
             'inputs': inputs, 'scope': 'Strict offline contact only; no runtime acceptance', 'samples': []}
    journal = DIRECTORY/'strict-contact-proof-02.json'

    def save():
        journal.write_text(json.dumps(proof, indent=2)+'\n')

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(author.RIG))
        original_neck = Surface(bpy.data.objects['Overshirt body'], bpy.context.evaluated_depsgraph_get())
        edges = {tuple(sorted(edge)) for edge in boundary_edges(original_neck.triangles)}
        assert len(edges) == 96, 'Original neck boundary changed'
        SOURCE_NECK = {'edges': edges, 'points': original_neck.points}
        proof['approved_neck_boundary_sha256'] = hashlib.sha256(json.dumps(sorted(edges)).encode()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(MODEL))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root = bpy.data.objects['OTTOMAN_MODEL_ROOT']
        body = bpy.data.collections['Preserved Sim reference - hidden']
        assert author.fingerprint(rig) == saved['preserved_scene_fingerprint']
        for frame in range(1, 5):
            proof['samples'].append(check_frame(scene, rig, root, body, frame))
            save()
        assert all(digest(ROOT/name) == expected for name, expected in inputs.items())
        proof.update(state='complete', accepted=True, source_bytes_unchanged=True)
        save()
    except Exception:
        proof.update(state='failed', accepted=False, error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    main()
