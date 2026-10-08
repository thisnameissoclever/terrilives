"""Conservative clearance and sampled bedding support for the folded sleep pose."""
import bpy
from mathutils import Vector


def mesh_points(obj, deps):
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ point.co for point in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def point_bounds(points):
    return [[min(p[i] for p in points) for i in range(3)],
            [max(p[i] for p in points) for i in range(3)]]


def structural_names():
    names = {f'Post {x} {y}' for x in (-.43, .43) for y in (-.925, .925)}
    for level in ('Lower', 'Upper'):
        names.update(f'{level} side rail {x}' for x in (-.425, .425))
        names.update(f'{level} end rail {y}' for y in (-.925, .925))
        names.add(f'{level} platform')
    names.update(('Upper rear guard', 'Upper access guard', 'Upper access upright'))
    names.update(f'Upper end guard {y}' for y in (-.925, .925))
    names.update(f'Ladder upright {y}' for y in (-.82, -.43))
    names.update(f'Ladder rung {z}' for z in (.24, .54, .84, 1.14, 1.44))
    assert len(names) == 26
    return names


def support(points, surface, deps):
    evaluated = surface.evaluated_get(deps)
    inverse = evaluated.matrix_world.inverted()
    gaps, contacts = [], []
    for point in points:
        hit, position, _, _ = evaluated.ray_cast(inverse @ Vector((point.x, point.y, 3)),
                                               inverse.to_3x3() @ Vector((0, 0, -1)))
        if hit:
            gap = point.z-(evaluated.matrix_world @ position).z
            gaps.append(gap)
            if -.025 <= gap <= .01:
                contacts.append(point)
    assert gaps and -.025 <= min(gaps) <= .01, f'Lost bedding support: {surface.name}'
    assert len(contacts) >= 3, f'Insufficient contact samples: {surface.name}'
    low, high = point_bounds(contacts)
    assert high[0]-low[0] >= .03 and high[1]-low[1] >= .003, f'Contact collapses to a point or line: {surface.name}'
    return {'query_count':len(points), 'ray_hits':len(gaps), 'contact_count':len(contacts),
            'min_gap':min(gaps), 'contact_bounds':[low, high]}


def measure(root, collection, frame):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    structure = structural_names()
    upper_bedding = {'Upper mattress', 'Upper pillow', 'Upper duvet', 'Upper duvet fold'}
    expected = structure | upper_bedding | {'Lower mattress', 'Lower pillow'}
    actual = {obj.name:obj for obj in root.children_recursive}
    assert set(actual) == expected, 'Bunk part inventory changed'
    assert all(obj.type == 'MESH' for obj in actual.values()), 'Non-mesh bunk geometry needs explicit collision handling'
    visible = [obj for obj in collection.all_objects if not obj.hide_render]
    assert visible and all(obj.type == 'MESH' for obj in visible), 'Visible non-mesh Sim geometry needs explicit collision handling'
    points = {obj.name:mesh_points(obj, deps) for obj in visible}
    required = {'Overshirt body', 'Sculpted head', 'HAIR_01_TRIPO_CURL',
                'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}
    assert required <= set(points), 'Required support body parts are missing'
    measured = {name:point_bounds(mesh) for name, mesh in points.items()}
    low, high = point_bounds([point for mesh in points.values() for point in mesh])
    obstacle_names = structure | upper_bedding
    obstacles = {name:point_bounds(mesh_points(actual[name], deps)) for name in obstacle_names}
    overlaps = []
    for name, (body_low, body_high) in measured.items():
        for obstacle, (obstacle_low, obstacle_high) in obstacles.items():
            if all(body_low[i] < obstacle_high[i] and obstacle_low[i] < body_high[i]
                   for i in range(3)):
                overlaps.append([name, obstacle])
    assert not overlaps, f'Body/obstacle overlap needs inspection: {overlaps}'
    assert low[1] >= -.90 and high[1] <= .90, 'Sleeper leaves mattress length'
    contacts = {name:support(points[name], actual['Lower mattress'], deps)
                for name in ('Overshirt body', 'Fitted rounded shoe sole',
                             'Fitted rounded shoe sole.001')}
    head = [v for name in ('Sculpted head', 'HAIR_01_TRIPO_CURL')
            for v in points[name] if .02 < abs(v.x) < .25 and .66 < v.y < .80]
    contacts['head_to_pillow'] = support(head, actual['Lower pillow'], deps)
    return {'frame':frame, 'bounds':[low, high], 'parts':measured,
            'structural_inventory':sorted(structure), 'obstacles':sorted(obstacle_names),
            'excluded_visible_geometry':[], 'body_obstacle_overlap_candidates':overlaps,
            'support_samples':contacts}
