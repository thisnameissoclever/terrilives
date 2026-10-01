"""Editable upholstery, sewn edge and four grounded wooden feet."""
import math

import bmesh
from mathutils import Vector

from build_parts import box, cylinder, material, mesh
from ottoman_layout import parts, welt_path


def build(root):
    palette = {
        'wood': material('Ottoman walnut feet', (.115, .075, .045)),
        'fabric': material('Ottoman deep teal base', (.19, .28, .25)),
        'cushion': material('Ottoman muted teal cushion', (.29, .405, .365)),
        'seam': material('Ottoman teal seam', (.22, .32, .285)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
    cylinder('Covered button', (0, 0, .382), (0, 0, .390), .018, palette['seam'], root)
    path, sides = welt_path(), 12
    vertices = []
    for index, point in enumerate(path):
        tangent = (Vector(path[(index+1)%len(path)])-Vector(path[index-1])).normalized()
        outward = Vector((tangent.y, -tangent.x, 0))
        for side in range(sides):
            theta = side/sides*math.tau
            vertices.append(Vector(point)+outward*(.003*math.cos(theta))
                            +Vector((0, 0, .003*math.sin(theta))))
    faces = []
    for row in range(len(path)):
        for side in range(sides):
            i, j = row*sides+side, row*sides+(side+1)%sides
            next_i, next_j = ((row+1)%len(path))*sides+side, ((row+1)%len(path))*sides+(side+1)%sides
            faces.append((i, j, next_j, next_i))
    obj = mesh('Cushion welt', vertices, faces, palette['seam'], root)
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()
    for face in obj.data.polygons:
        face.use_smooth = True
    return {'base_footprint': [1, 1], 'feet': 4, 'cushion_height': .385,
            'maximum_height': .390, 'seated_animation_proven': False}
