"""Measure the new complete body and evaluated duvet against the bunk solids."""
import bpy

from bunk_contact import point_bounds, structural_names, support
from double_bed_sleep import surface, surfaces, tree


def measure(state):
    """Require occupied canonical geometry, sampled support and no cloth crossings."""
    if state['occupancy'] != 1 or state['blanket'] is None:
        raise ValueError('Expected one occupied lower bunk')
    if abs(state['root'].rotation_euler.z) > 1e-6:
        raise ValueError('Measure bunk fit before its facing rotation')
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    structure = structural_names()
    upper = {'Upper mattress', 'Upper pillow', 'Upper duvet', 'Upper duvet fold'}
    expected = structure | upper | {'Lower mattress', 'Lower pillow', 'Covered bunk occupied duvet'}
    objects = {obj.name: obj for obj in state['root'].children_recursive}
    if set(objects) != expected or any(obj.type != 'MESH' for obj in objects.values()):
        raise ValueError('Covered bunk furniture inventory changed')
    body = surfaces(state['body'])
    required = {'Overshirt body', 'Sculpted head', 'HAIR_01_TRIPO_CURL',
                'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}
    if not required <= set(body) or any(not points or not triangles for points, triangles in body.values()):
        raise ValueError('Missing evaluated sleeping body geometry')
    bounds = {name: point_bounds(value[0]) for name, value in body.items()}
    whole = point_bounds([point for value in body.values() for point in value[0]])
    low, high = whole
    if low[0] <= -.38 or high[0] >= .38 or low[1] <= -.93 or high[1] >= .93:
        raise ValueError('Sleeping body leaves the measured mattress')
    obstacle_surfaces = {name: surface(objects[name], deps) for name in structure | upper}
    obstacles = {name: point_bounds(value[0]) for name, value in obstacle_surfaces.items()}
    overlaps = [[name, obstacle] for name, (a, b) in bounds.items()
                for obstacle, (c, d) in obstacles.items()
                if all(a[i] < d[i] and c[i] < b[i] for i in range(3))]
    if overlaps:
        raise ValueError('Body/frame overlap: ' + repr(overlaps))
    contacts = {name: support(body[name][0], objects['Lower mattress'], deps)
                for name in ('Overshirt body', 'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001')}
    head = [point for name in ('Sculpted head', 'HAIR_01_TRIPO_CURL') for point in body[name][0]]
    contacts['head_to_pillow'] = support(head, objects['Lower pillow'], deps)
    cloth = surface(state['blanket'], deps)
    if not cloth[0] or not cloth[1]:
        raise ValueError('Missing evaluated occupied duvet')
    cloth_tree = tree(cloth)
    body_crossings = {name: len(cloth_tree.overlap(tree(value))) for name, value in body.items()}
    if any(body_crossings.values()):
        raise ValueError('Duvet intersects body: ' + repr({k: v for k, v in body_crossings.items() if v}))
    other_surfaces = dict(obstacle_surfaces)
    other_surfaces.update({name: surface(objects[name], deps) for name in ('Lower mattress', 'Lower pillow')})
    furniture_crossings = {name: len(cloth_tree.overlap(tree(value))) for name, value in other_surfaces.items()}
    if any(furniture_crossings.values()):
        raise ValueError('Duvet intersects furniture: ' + repr({k: v for k, v in furniture_crossings.items() if v}))
    return {'body_bounds': whole, 'body_parts': bounds, 'cloth_bounds': point_bounds(cloth[0]),
            'structural_inventory': sorted(structure), 'furniture_inventory': sorted(expected),
            'body_obstacle_overlap_candidates': overlaps, 'support_samples': contacts,
            'cloth_body_triangle_crossings': body_crossings,
            'cloth_furniture_triangle_crossings': furniture_crossings}
