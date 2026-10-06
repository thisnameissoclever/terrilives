"""One asymmetric, unoutlined graphic cloud with opaque constant-emission colour."""
import math
import json

EXTERIOR_NAME = 'Shower continuous graphic cloud exterior'
MATERIAL_NAME = 'Shower opaque graphic cloud emission'


def material_spec():
    return dict(shader='constant-emission', rgba=[.75, .82, .84, 1], strength=1,
                normal_based_shading=False, transparency=False,
                node_types=['ShaderNodeEmission', 'ShaderNodeOutputMaterial'])


def validate_exterior_inventory(names):
    if set(names) != {EXTERIOR_NAME}:
        raise ValueError('Graphic cloud decoration must be exactly one exterior mesh')


def exterior_geometry(columns=96, rows=28):
    if columns < 32 or rows < 12 or columns % 2:
        raise ValueError('Cloud exterior needs a complete even closed radial grid')
    # Angularly staggered, unequal bulges change the outline locally. No row
    # receives a shared radial roll or a separate spherical material region.
    bulges = ((.2, .31, .040, .52, .16), (2.5, .75, .027, .80, .20),
              (4.4, .20, .040, .55, .10), (5.8, .60, .044, .65, .20),
              (1.4, 1.07, .032, .52, .15), (3.5, .42, .036, .60, .24))
    vertices, radii, heights = [], [], []
    for row in range(rows+1):
        t = row/rows
        ring_radii = []
        for i in range(columns):
            angle = math.tau*i/columns
            bottom = .064+.004*math.sin(angle+.6)
            top = 1.083+.045*math.sin(angle+1.2)+.030*math.sin(3*angle-.4)
            z = bottom+(top-bottom)*t
            radius = .286
            for azimuth, height, size, width, vertical_width in bulges:
                angular = math.atan2(math.sin(angle-azimuth), math.cos(angle-azimuth))
                radius += size*math.exp(-.5*((angular/width)**2+((z-height)/vertical_width)**2))
            vertices.append((.015+radius*math.cos(angle), -.025+.95*radius*math.sin(angle), z))
            ring_radii.append(radius)
            if row == rows:
                heights.append(z)
        radii.append(ring_radii)
    triangles = []
    for row in range(rows):
        for i in range(columns):
            j = (i+1)%columns
            a, b, c, d = row*columns+i, row*columns+j, (row+1)*columns+j, (row+1)*columns+i
            triangles += [(a, b, c), (a, c, d)]
    bottom_index = len(vertices)
    vertices.append((.015, -.025, .058))
    top_index = len(vertices)
    vertices.append((.045, -.010, 1.105))
    for i in range(columns):
        j = (i+1)%columns
        triangles += [(bottom_index, j, i), (top_index, rows*columns+i, rows*columns+j)]
    asymmetry = max(abs(ring[i]-ring[(i+columns//2)%columns]) for ring in radii for i in range(columns))
    return vertices, triangles, dict(one_closed_surface=True, columns=columns, rows=rows,
        top_boundary_height_range=max(heights)-min(heights), asymmetric_boundary_displacement=asymmetry,
        angularly_staggered_bulges=[list(b) for b in bulges], circumferential_rolls=False,
        per_lobe_normal_shading=False, construction='One radial manifold with unequal localized outline bulges and staggered top boundary')


def closed_surface_certificate(vertices, triangles):
    if not vertices or not triangles or any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in vertices):
        raise ValueError('Exterior evidence must be complete and finite')
    edges, volume = {}, 0.
    for index, triangle in enumerate(triangles):
        if len(triangle) != 3 or len(set(triangle)) != 3 or any(not isinstance(i, int) or not 0 <= i < len(vertices) for i in triangle):
            raise ValueError('Invalid exterior triangle')
        a, b, c = [vertices[i] for i in triangle]
        cross = (b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0])
        volume += sum(x*y for x, y in zip(a, cross))/6
        for first, second in zip(triangle, triangle[1:]+triangle[:1]):
            edges.setdefault(tuple(sorted((first, second))), []).append((first, second, index))
    if any(len(uses) != 2 or uses[0][:2] != tuple(reversed(uses[1][:2])) for uses in edges.values()):
        raise ValueError('Graphic exterior is not closed with consistent winding')
    neighbors = {i:set() for i in range(len(triangles))}
    for uses in edges.values():
        first, second = uses[0][2], uses[1][2]
        neighbors[first].add(second)
        neighbors[second].add(first)
    visited, frontier = {0}, {0}
    while frontier:
        following = set().union(*(neighbors[i] for i in frontier))-visited
        visited |= following
        frontier = following
    if len(visited) != len(triangles) or volume <= 0:
        raise ValueError('Graphic exterior is not one connected outward surface')
    return dict(closed=True, connected=True, consistent_winding=True, signed_volume=volume,
                evaluated_vertices=len(vertices), evaluated_triangles=len(triangles))


def build(root):
    import bpy
    spec = material_spec()
    mat = bpy.data.materials.new(MATERIAL_NAME)
    mat.use_nodes = True
    mat.diffuse_color = spec['rgba']
    tree = mat.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = spec['rgba']
    emission.inputs['Strength'].default_value = spec['strength']
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
    vertices, triangles, metadata = exterior_geometry()
    closed_surface_certificate(vertices, triangles)
    data = bpy.data.meshes.new(EXTERIOR_NAME)
    data.from_pydata(vertices, [], triangles)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(EXTERIOR_NAME, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj['collision_solid'] = False
    obj['structural_support'] = False
    obj['cloud_material_contract'] = 'opaque-constant-emission-no-normal-shading'
    obj['construction_json'] = json.dumps(metadata, allow_nan=False)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj, metadata
