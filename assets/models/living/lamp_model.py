"""Editable, closed lamp meshes without a false cap across either shade opening."""
import math

import bmesh

from build_parts import cylinder, material, mesh
from lamp_layout import parts


def lathe(part, mat, root):
    sides = 96
    profile = part['profile']
    vertices, rings = [], []
    for radius, height in profile:
        if radius == 0:
            rings.append([len(vertices)]*sides)
            vertices.append((0, 0, height))
        else:
            rings.append(list(range(len(vertices), len(vertices)+sides)))
            vertices.extend((radius*math.cos(i*math.tau/sides),
                             radius*math.sin(i*math.tau/sides), height) for i in range(sides))
    faces = []
    for ring in range(len(profile)):
        following = (ring+1) % len(profile)
        for i in range(sides):
            j = (i+1) % sides
            face = tuple(dict.fromkeys((rings[ring][i], rings[ring][j],
                                       rings[following][j], rings[following][i])))
            if len(face) >= 3:
                faces.append(face)
    obj = mesh(part['name'], vertices, faces, mat, root)
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < .999
    return obj


def build(root):
    palette = {
        'metal': material('Lamp aged warm grey metal', (.26, .245, .205)),
        'cream': material('Lamp warm linen shade', (.78, .665, .46)),
        'bulb': material('Lamp pale bulb', (.86, .79, .61)),
    }
    for part in parts():
        mat = palette[part['material']]
        if part['shape'] == 'lathe':
            obj = lathe(part, mat, root)
        else:
            obj = cylinder(part['name'], part['a'], part['b'], part['radius'], mat, root)
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'base_footprint': [1, 1], 'shade_openings': 2,
            'shade_wall_thickness': .009, 'runtime_light': 'unchanged'}
