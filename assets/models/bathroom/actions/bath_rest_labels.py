"""Neutral evaluated topology labels remain valid under blended body articulation."""
import math


def verified_topology(before, after):
    if len(before['vertices_world']) != len(after['vertices_world']) or before['polygons'] != after['polygons']:
        raise ValueError('Neutral/posed evaluated topology correspondence is unproven')
    if any(len(p) != 3 or not all(math.isfinite(v) for v in p)
           for mesh in (before, after) for p in mesh['vertices_world']):
        raise ValueError('Evaluated label geometry must be finite and complete')
    return True


def verify_neutral_fidelity(before, after, tolerance=1e-6):
    verified_topology(before, after)
    errors = [math.dist(a, b) for a, b in zip(before['vertices_world'], after['vertices_world'])]
    if not errors or max(errors) > tolerance:
        raise ValueError('Derived articulation changed neutral evaluated geometry')
    return dict(state='passed', evaluated_vertices=len(errors), max_error=max(errors),
                tolerance=tolerance, topology_verified=True, original_control_ids_assigned=False)


def canonical_triangles(mesh):
    return [tuple((poly[0], poly[i], poly[i+1])) for poly in mesh['polygons'] for i in range(1, len(poly)-1)]


def rear_triangle_labels(neutral, posed, window):
    verified_topology(neutral, posed)
    return [tri for tri in canonical_triangles(neutral)
            if all(window[0] <= neutral['vertices_world'][i][2] <= window[1]
                   and neutral['vertices_world'][i][1] >= .025 for i in tri)]


def capture_evaluated(objects, role='evaluated modifier output'):
    import bpy
    deps = bpy.context.evaluated_depsgraph_get()
    result = {}
    for obj in objects:
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            result[obj.name] = dict(vertices_world=[list(evaluated.matrix_world@v.co) for v in mesh.vertices],
                polygons=[list(p.vertices) for p in mesh.polygons], triangles=[list(t.vertices) for t in mesh.loop_triangles],
                vertex_index_space=role, original_control_ids_assigned=False)
        finally:
            evaluated.to_mesh_clear()
    return result


def capture_neutral(objects):
    return capture_evaluated(objects, 'separately evaluated neutral modifier output')
