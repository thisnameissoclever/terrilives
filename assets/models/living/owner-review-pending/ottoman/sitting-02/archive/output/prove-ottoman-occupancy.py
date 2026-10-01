"""Exercise the corrected surface and torso-envelope collision predicates."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'output'))
from surface_volume import ClosedSurface, boundary_edges
from test_surface_volume import prism

CHECKER = ROOT/'output/check-ottoman-sit-candidate-02.py'
spec = importlib.util.spec_from_file_location('ottoman_contact', CHECKER)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
DIRECTORY = ROOT/'output/ottoman-sit-candidate-02'
FIXTURE = ROOT/'output/ottoman-sit-candidate-01/ottoman-sit-authoring.blend'
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def surface(name, points, faces):
    result = checker.Surface.__new__(checker.Surface)
    result.name, result.points, result.triangles = name, points, faces
    result.low = [min(p[i] for p in points) for i in range(3)]
    result.high = [max(p[i] for p in points) for i in range(3)]
    result.tree = BVHTree.FromPolygons(points, faces, all_triangles=True, epsilon=0)
    result._volume, result.volume_tree, result.analysis_cap_faces = None, None, 0
    return result


def main():
    assert bpy.app.background
    inputs = {str(p.relative_to(ROOT)): digest(p) for p in
              (CHECKER, ROOT/'output/surface_volume.py', ROOT/'output/test_surface_volume.py', Path(__file__), FIXTURE)}
    assert digest(FIXTURE) == '94133712898a8a544b1965f1af882d97ab746f233ba720be6c33e0370466ffe3'
    proof = {'state': 'running', 'pid': os.getpid(), 'inputs': inputs, 'cases': []}
    journal = DIRECTORY/'occupancy-regression-proof.json'

    def save():
        journal.write_text(json.dumps(proof, indent=2)+'\n')

    def record(name, **fields):
        proof['cases'].append({'name': name, 'passed': True, **fields})
        save()

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(FIXTURE))
        bpy.context.scene.frame_set(2)
        deps = bpy.context.evaluated_depsgraph_get()
        forearm = checker.Surface(bpy.data.objects['Forearm with elbow and wrist sections'], deps)
        witness = Vector((-.15401500463485718, .14313557744026184, 1.0446280241012573))
        nearest, normal, _, _ = forearm.tree.find_nearest(witness)
        assert (witness-nearest).dot(normal) < 0
        assert not forearm.volume().contains(tuple(witness))
        record('recorded_false_forearm_containment', old_normal_dot=(witness-nearest).dot(normal),
               actual_contains=False)
        palm = checker.Surface(bpy.data.objects['Relaxed palm'], deps)
        thigh = checker.Surface(bpy.data.objects['Tailored trouser leg'], deps)
        result = checker.collision(palm, thigh)
        assert result and result['kind'] == 'surface'
        record('candidate01_palm_thigh_crossing_still_rejected', result=result)

        big = surface('outer', *prism([(0, 0), (1, 0), (1, 1), (0, 1)]))
        small = surface('inner', *prism([(.2, .2), (.3, .2), (.3, .3), (.2, .3)], .2, .3))
        assert checker.collision(big, small)['kind'] == 'second_inside_first'
        assert checker.collision(small, big)['kind'] == 'first_inside_second'
        record('fully_enclosed_solid_rejected_in_both_orders')
        contains = ClosedSurface.enclosed_components
        ClosedSurface.enclosed_components = lambda self, other: []
        try:
            assert checker.collision(big, small) is None
        finally:
            ClosedSurface.enclosed_components = contains
        assert checker.collision(big, small) is not None
        record('deleted_containment_guard_makes_enclosed_solid_pass')

        concave = surface('concave', *prism([(0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2)]))
        notch = surface('in_notch', *prism([(1.2, 1.2), (1.4, 1.2), (1.4, 1.4), (1.2, 1.4)], .2, .4))
        assert checker.collision(concave, notch) is None
        record('disjoint_concave_surfaces_with_overlapping_boxes_pass')

        points, faces = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        open_faces = faces[:2]+faces[4:]
        checker.SOURCE_NECK = {'points': points, 'edges': {tuple(sorted(e)) for e in boundary_edges(open_faces)}}
        torso = surface('Overshirt body', points, open_faces)
        crossing_points, crossing_faces = prism([(.4, .4), (.6, .4), (.6, .6), (.4, .6)], .9, 1.1)
        # Start this connected surface outside the cap, so containment cannot
        # detect the partial intrusion and the cap-crossing guard is necessary.
        crossing_faces = crossing_faces[2:4]+crossing_faces[:2]+crossing_faces[4:]
        entering = surface('forearm_fixture', crossing_points, crossing_faces)
        assert not torso.tree.overlap(entering.tree)
        result = checker.collision(torso, entering)
        assert result and result['kind'] == 'analysis_envelope_intrusion'
        record('neck_entry_without_cloth_crossing_is_rejected', result=result)
        source = CHECKER.read_text().replace('if envelope_crossing:', 'if False and envelope_crossing:')
        namespace = {'__name__': 'deleted_cap_guard', '__file__': str(CHECKER)}
        exec(compile(source, str(CHECKER), 'exec'), namespace)
        assert namespace['collision'](torso, entering) is None
        record('deleted_cap_crossing_guard_makes_partial_intrusion_pass')
        assert all(digest(ROOT/name) == expected for name, expected in inputs.items())
        proof.update(state='complete', source_bytes_unchanged=True)
        save()
    except Exception:
        proof.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    main()
