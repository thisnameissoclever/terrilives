"""Wood-clad above-ground pool with stone coping, blue water and a chrome ladder."""
import bmesh
import bpy

from build_parts import box, cylinder, material, mesh
from pool_activity_rail_v4 import fitted_rail
import pool_activity_layout_v4 as L


def normals(obj):
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()


def ring(name, outer, inner, z0, z1, mat, root, inner_mat=None, bevel=0):
    vertices, faces, inner_faces = L.square_ring(outer, inner, z0, z1)
    obj = mesh(name, vertices, faces, mat, root)
    if inner_mat is not None:
        obj.data.materials.append(inner_mat)
        for index in inner_faces:
            obj.data.polygons[index].material_index = 1
    normals(obj)
    if bevel:
        modifier = obj.modifiers.new('Soft edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj


def boolean(target, tool, operation, remove=True):
    bpy.context.view_layer.objects.active=target
    modifier=target.modifiers.new('Real ladder recess '+operation,'BOOLEAN')
    modifier.operation=operation
    modifier.solver='EXACT'
    modifier.object=tool
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if remove:
        bpy.data.objects.remove(tool,do_unlink=True)


def recessed_wall(wood, liner, root, layout=L):
    vertices,faces,materials=layout.recessed_wall_geometry()
    result=mesh('Pool wall',vertices,faces,wood,root)
    result.data.materials.append(liner)
    for polygon,index in zip(result.data.polygons,materials):polygon.material_index=index
    normals(result)
    return result


def build(root, layout=L, *, coping_bevel=.006):
    stone = material('Pool pale stone coping', (.66, .62, .55))
    wood = material('Pool warm wood cladding', (.36, .22, .12))
    trim = material('Pool dark wood trim', (.17, .10, .055))
    liner = material('Pool pale aqua liner', (.42, .62, .66))
    water = material('Pool clear blue water', (.06, .33, .58))
    ripple = material('Pool water ripple highlight', (.30, .60, .78))
    chrome = material('Pool ladder chrome', (.62, .66, .68))
    rubber = material('Pool ladder rubber bumpers', (.05, .05, .055))

    wall = recessed_wall(wood,liner,root,layout)
    bands=[]
    for index, (z0, z1) in enumerate(L.TRIM_BANDS):
        bands.append(ring(f'Pool wall trim band {index+1}', L.WALL_HALF+L.TRIM_OUT,
             L.WALL_HALF-.01, z0, z1, trim, root))
    coping = ring('Pool stone coping', L.COPING_HALF, L.COPING_INNER_HALF,
         L.COPING_BOTTOM, L.COPING_TOP, stone, root, bevel=coping_bevel)
    for index,(low,high) in enumerate(L.TOE_RECESS_HEIGHTS):
        tool=box(f'Pool toe recess tool {index}',
                 ((layout.TOE_RECESS_X[0]+layout.TOE_RECESS_X[1])/2,(L.TOE_RECESS_BACK_Y+1.02)/2,(low+high)/2),
                 (layout.TOE_RECESS_X[1]-layout.TOE_RECESS_X[0],1.02-L.TOE_RECESS_BACK_Y,high-low),wood,root,bevel=0)
        for target in [*bands,coping]:
            boolean(target,tool,'DIFFERENCE',remove=False)
        bpy.data.objects.remove(tool,do_unlink=True)
    normals(wall)
    vertices, faces, ripples = L.water_grid()
    surface = mesh('Pool water surface', vertices, faces, water, root)
    surface.data.materials.append(ripple)
    for face, highlighted in zip(surface.data.polygons, ripples):
        face.material_index = int(highlighted)

    for index, x in enumerate(layout.LADDER_RAIL_X):
        fitted_rail(f'Pool ladder rail {index+1}', layout.ladder_rail_points(x),
             L.LADDER_RAIL_RADIUS, chrome, root, getattr(layout,'OUTER_SLOPE',0))
        foot_y = L.LADDER_SIDE_Y*L.LADDER_PATH[-1][0]
        for z in L.LADDER_BUMPER_Z:
            cylinder(f'Pool ladder bumper {index+1} {z}',
                     (x, foot_y, z), (x, L.LADDER_SIDE_Y*(L.WALL_HALF-.002), z),
                     .016, rubber, root)
    for index, x in enumerate(layout.LADDER_RAIL_X):
        for flight, points in enumerate(layout.LADDER_STRINGERS):
            for section, (start, end) in enumerate(zip(points, points[1:])):
                suffix = '' if section == 0 else ' upper'
                cylinder(f'Pool ladder stringer {index+1} {flight+1}{suffix}',
                         (x, *start), (x, *end), L.LADDER_RAIL_RADIUS, chrome, root)
    for side, treads in [('outside', getattr(layout,'LADDER_OUTSIDE_TREADS',L.LADDER_OUTSIDE_TREADS)), ('inside', layout.LADDER_INSIDE_TREADS)]:
        for index, (y,z) in enumerate(treads):
            x0,x1=layout.LADDER_RAIL_X
            depth=L.OUTSIDE_RUNG_DEPTH if side=='outside' else L.INSIDE_RUNG_DEPTH
            y0,y1=y-depth/2,y+depth/2
            z0,z1=z-L.RUNG_THICKNESS,z
            vertices=[(x,y,z) for z in [z0,z1] for y in [y0,y1] for x in [x0,x1]]
            faces=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
            mesh(f'Pool {side} ladder tread {index+1}',vertices,faces,chrome,root)
    box('Pool ladder crest landing',
        (L.LADDER_CENTER_X, layout.CREST_LANDING_Y, L.CREST_LANDING_TOP-L.RUNG_THICKNESS/2),
        (layout.LADDER_RAIL_X[1]-layout.LADDER_RAIL_X[0], layout.CREST_LANDING_DEPTH, L.RUNG_THICKNESS),
        chrome, root, bevel=0)
    mesh('Pool basin floor',[(-L.WALL_INNER_HALF,-L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (L.WALL_INNER_HALF,-L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (L.WALL_INNER_HALF,L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (-L.WALL_INNER_HALF,L.WALL_INNER_HALF,L.BASIN_FLOOR_Z)],[(0,1,2,3)],liner,root)
    half_x, half_y, top = L.outer_bounds()
    return {'footprint': list(L.FOOTPRINT), 'rim_outer': [2*L.COPING_HALF]*2,
            'coping_top': L.COPING_TOP, 'water_z': L.WATER_Z,
            'outer_bounds': [2*half_x, 2*half_y, top],
            'toe_recess_back': L.TOE_RECESS_BACK_Y, 'liner_backing_inner': L.BACKING_INNER_Y,
            'liner_backing_thickness': L.TOE_RECESS_BACK_Y-L.BACKING_INNER_Y,
            'declared_maximum_exterior_y': 1.0, 'decorative': False, 'rungs': len(L.RUNG_HEIGHTS)*2, 'ladder_side': '+Y'}
