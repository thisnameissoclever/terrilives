"""Wood-clad above-ground pool with stone coping, blue water and a chrome ladder."""
import bmesh

from build_parts import cylinder, material, mesh, tube
import pool_activity_layout_v2 as L


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


def build(root):
    stone = material('Pool pale stone coping', (.66, .62, .55))
    wood = material('Pool warm wood cladding', (.36, .22, .12))
    trim = material('Pool dark wood trim', (.17, .10, .055))
    liner = material('Pool pale aqua liner', (.42, .62, .66))
    water = material('Pool clear blue water', (.06, .33, .58))
    ripple = material('Pool water ripple highlight', (.30, .60, .78))
    chrome = material('Pool ladder chrome', (.62, .66, .68))
    rubber = material('Pool ladder rubber bumpers', (.05, .05, .055))

    ring('Pool wall', L.WALL_HALF, L.WALL_INNER_HALF, 0, L.COPING_BOTTOM,
         wood, root, inner_mat=liner)
    for index, (z0, z1) in enumerate(L.TRIM_BANDS):
        ring(f'Pool wall trim band {index+1}', L.WALL_HALF+L.TRIM_OUT,
             L.WALL_HALF-.01, z0, z1, trim, root)
    ring('Pool stone coping', L.COPING_HALF, L.COPING_INNER_HALF,
         L.COPING_BOTTOM, L.COPING_TOP, stone, root, bevel=.006)
    vertices, faces, ripples = L.water_grid()
    surface = mesh('Pool water surface', vertices, faces, water, root)
    surface.data.materials.append(ripple)
    for face, highlighted in zip(surface.data.polygons, ripples):
        face.material_index = int(highlighted)

    for index, x in enumerate(L.LADDER_RAIL_X):
        tube(f'Pool ladder rail {index+1}', L.ladder_rail_points(x),
             L.LADDER_RAIL_RADIUS, chrome, root)
        foot_y = L.LADDER_SIDE_Y*L.LADDER_PATH[-1][0]
        for z in L.LADDER_BUMPER_Z:
            cylinder(f'Pool ladder bumper {index+1} {z}',
                     (x, foot_y, z), (x, L.LADDER_SIDE_Y*(L.WALL_HALF-.002), z),
                     .016, rubber, root)
    for side,y in [('outside',L.LADDER_OUTSIDE_Y),('inside',L.LADDER_INSIDE_Y)]:
        for index,z in enumerate(L.RUNG_HEIGHTS):
            x0,x1=L.LADDER_RAIL_X
            y0,y1=y-L.RUNG_DEPTH/2,y+L.RUNG_DEPTH/2
            z0,z1=z-L.RUNG_THICKNESS,z
            vertices=[(x,y,z) for z in [z0,z1] for y in [y0,y1] for x in [x0,x1]]
            faces=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
            mesh(f'Pool {side} ladder tread {index+1}',vertices,faces,chrome,root)
    mesh('Pool basin floor',[(-L.WALL_INNER_HALF,-L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (L.WALL_INNER_HALF,-L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (L.WALL_INNER_HALF,L.WALL_INNER_HALF,L.BASIN_FLOOR_Z),
         (-L.WALL_INNER_HALF,L.WALL_INNER_HALF,L.BASIN_FLOOR_Z)],[(0,1,2,3)],liner,root)
    half_x, half_y, top = L.outer_bounds()
    return {'footprint': list(L.FOOTPRINT), 'rim_outer': [2*L.COPING_HALF]*2,
            'coping_top': L.COPING_TOP, 'water_z': L.WATER_Z,
            'outer_bounds': [2*half_x, 2*half_y, top],
            'decorative': False, 'rungs': len(L.RUNG_HEIGHTS)*2, 'ladder_side': '+Y'}
