"""Wider crest passage on the existing square pool and ladder approach."""
from pool_activity_model_v4 import build as build_compact_pool
from pool_activity_layout_v5 import (
    LEFT_DISPLACEMENT, LEFT_HARDWARE, LEFT_RAIL_X, RIGHT_RAIL_X, SUPPORTS,
    TOE_RECESS_X, support_edge,
)


def widen_ladder(root):
    from mathutils import Matrix
    by_name = {obj.name: obj for obj in root.children_recursive}
    rail = by_name['Pool ladder rail 1']
    path = by_name[rail['pool_rail_path']]
    if not TOE_RECESS_X[0] < LEFT_RAIL_X - path.data.bevel_depth:
        raise ValueError('The widened rail must stay inside the real toe recess.')
    # Hidden editable curves are absent from viewport transform evaluation.
    # Keep the original shared object frame and translate the actual control points and mesh.
    translation = Matrix.Translation((LEFT_DISPLACEMENT, 0, 0))
    path.data.transform(translation)
    rail.data.transform(translation)
    rail.data.update()
    for name in LEFT_HARDWARE:
        if name != rail.name:
            by_name[name].location.x += LEFT_DISPLACEMENT

    for name in SUPPORTS:
        obj = by_name[name]
        # The crest's origin is at its centre. The treads use pool-local coordinates.
        local = obj.matrix_local.copy()
        inverse = local.inverted()
        for vertex in obj.data.vertices:
            point = local @ vertex.co
            point.x = support_edge(point.x)
            vertex.co = inverse @ point
        obj.data.update()


def build(root):
    import bpy
    checks = build_compact_pool(root)
    bpy.context.view_layer.update()
    widen_ladder(root)
    bpy.context.view_layer.update()
    return {**checks, 'rail_centers_x': [LEFT_RAIL_X, RIGHT_RAIL_X]}
