"""Editable wooden stand and one continuous, supported fabric mesh."""
import math
import bmesh
from mathutils import Matrix

from build_parts import box, cylinder, material, mesh
from coat_rack_layout import drape_point, parts


def build(root):
    wood = material('Coat rack warm oak', (.39, .235, .12))
    fabric = material('Coat rack muted teal fabric', (.20, .365, .33))
    for part in parts():
        if part['shape'] == 'box':
            obj = box(part['name'], part['center'], part['size'], wood, root, .009)
        else:
            obj = cylinder(part['name'], part['a'], part['b'], part['radius'], wood, root)
        obj['supports'] = part['supports']
    rows, columns = 200, 32
    vertices = [drape_point(row/rows, col/columns)
                for row in range(rows+1) for col in range(columns+1)]
    faces = []
    for row in range(rows):
        for col in range(columns):
            i = row*(columns+1)+col
            faces.append((i, i+1, i+columns+2, i+columns+1))
    obj = mesh('Hanging fabric', vertices, faces, fabric, root)
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()
    for face in obj.data.polygons:
        face.use_smooth = True
    thickness = obj.modifiers.new('Continuous fabric thickness', 'SOLIDIFY')
    thickness.thickness = .002
    thickness.offset = 0
    obj['supports'] = ['Rail']
    # The old SE rail ran along game X; the standard exporter adds 90 degrees.
    correction = Matrix.Rotation(-math.pi/2, 4, 'Z')
    for part in root.children:
        part.matrix_local = correction @ part.matrix_local
    return {'base_footprint': [1, 1], 'fabric_thickness': .002,
            'fabric_support': 'Continuous fold over rail', 'cloth_simulation': False}
