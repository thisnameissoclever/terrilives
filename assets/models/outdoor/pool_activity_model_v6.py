"""Pool with a relieved inside landing edge and a retained attachment strip around the left post."""
from pool_activity_model_v5 import build as build_wider_pool
from pool_activity_layout_v4 import CREST_LANDING_TOP, RUNG_THICKNESS
from pool_activity_layout_v5 import LEFT_RAIL_X, RIGHT_RAIL_X


def landing_outline():
    return [(LEFT_RAIL_X, .70), (-.775, .70), (-.755, .85), (-.570, .85),
            (-.50, .70), (RIGHT_RAIL_X, .70), (RIGHT_RAIL_X, 1.), (LEFT_RAIL_X, 1.)]


def build(root):
    import bpy
    from mathutils import Vector
    checks = build_wider_pool(root)
    obj = next(o for o in root.children_recursive if o.name == 'Pool ladder crest landing')
    outline = landing_outline()
    n = len(outline)
    verts = [tuple(obj.matrix_local.inverted() @ Vector((x,y,z))) for z in
             (CREST_LANDING_TOP-RUNG_THICKNESS, CREST_LANDING_TOP) for x,y in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, n+(i+1)%n, n+i) for i in range(n)]
    obj.data.clear_geometry()
    obj.data.from_pydata(verts, [], faces)
    obj.data.update()
    bpy.context.view_layer.update()
    return {**checks,'crest_outline':outline}
