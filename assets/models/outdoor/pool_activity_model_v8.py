"""Square pool with a recessed dry ladder well, a turning platform and an inclined outer flight."""
import bpy
from pool_activity_model_v4 import build as build_pool
import pool_activity_layout_v4 as basin
import pool_activity_layout_v8 as bay


def replace_mesh(obj,vertices,faces,materials,bevel=0):
    obj.modifiers.clear()
    obj.data.clear_geometry()
    obj.data.from_pydata(vertices,[],faces)
    for polygon,index in zip(obj.data.polygons,materials):polygon.material_index=index
    obj.data.update()
    if bevel:
        mod=obj.modifiers.new('Rounded stone rim','BEVEL')
        mod.width=bevel;mod.segments=3;mod.limit_method='ANGLE'
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')


def build(root):
    stats=build_pool(root,bay,coping_bevel=.003)
    objects={o.name:o for o in root.children_recursive}
    replace_mesh(objects['Pool stone coping'],*bay.grid_shell(bay.COPING_OUT,bay.COPING_IN,basin.COPING_BOTTOM,basin.COPING_TOP),bevel=.003)
    for n,(z0,z1) in enumerate(basin.TRIM_BANDS,1):
        outer=(bay.DRY[0]+.003,bay.DRY[1]+.003,bay.DRY[2]-.003,bay.DRY[3]+.003)
        inner=(bay.DRY[0]-.01,bay.DRY[1]-.01,bay.DRY[2]+.01,bay.DRY[3]-.01)
        v,f,_=bay.grid_shell(outer,inner,z0,z1)
        replace_mesh(objects[f'Pool wall trim band {n}'],v,f,[0]*len(f))
    v,f,_=bay.surface(bay.WET,basin.BASIN_FLOOR_Z)
    replace_mesh(objects['Pool basin floor'],v,f,[0]*len(f))
    v,f,c=bay.surface(bay.WATER,basin.WATER_Z,basin.WATER_GRID)
    replace_mesh(objects['Pool water surface'],v,f,[int(basin.in_ripple(x,y)) for x,y in c])
    bpy.context.view_layer.update()
    return {**stats,'dry_bay':bay.DRY,'wet_bay':bay.WET,'nosings':[y+basin.OUTSIDE_RUNG_DEPTH/2 for y,_ in bay.LADDER_OUTSIDE_TREADS]}
