"""Editable planter, connected stems and gently cupped broad leaves."""
import bmesh

from build_parts import box, cylinder, material, mesh
from plant_layout import leaf_point, leaves, pot_geometry


def normals(obj):
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()


def leaf_mesh(leaf, mat, root):
    rows, columns = 32, 12
    vertices = [leaf_point(leaf, 0, 0)]
    vertices += [leaf_point(leaf, row/rows, column/columns*2-1)
                 for row in range(1, rows) for column in range(columns+1)]
    tip = len(vertices)
    vertices.append(leaf_point(leaf, 1, 0))
    faces = [(0, 1+col, 2+col) for col in range(columns)]
    for row in range(rows-2):
        for col in range(columns):
            i = 1+row*(columns+1)+col
            faces.append((i, i+columns+1, i+columns+2, i+1))
    end = 1+(rows-2)*(columns+1)
    faces += [(end+col, tip, end+col+1) for col in range(columns)]
    obj = mesh(leaf['name'], vertices, faces, mat, root)
    normals(obj)
    for face in obj.data.polygons:
        face.use_smooth = True
    solid = obj.modifiers.new('Thin continuous leaf surface', 'SOLIDIFY')
    solid.thickness = .002
    solid.offset = 0
    return obj


def build(root):
    clay = material('Plant terracotta', (.42, .19, .095))
    soil = material('Plant dark earth', (.078, .046, .025))
    stem = material('Plant woody green stems', (.16, .19, .062))
    greens = [material(f'Plant leaf green {i}', colour) for i, colour in enumerate(
        ((.15, .29, .11), (.20, .34, .13), (.125, .25, .085)))]
    vertices, faces = pot_geometry()
    pot = mesh('Planter', vertices, faces, clay, root)
    normals(pot)
    bevel = pot.modifiers.new('Soft fired clay edges', 'BEVEL')
    bevel.width, bevel.segments = .006, 4
    pot.modifiers.new('Weighted planter normals', 'WEIGHTED_NORMAL')
    box('Soil', (0, 0, .175), (.295, .295, .206), soil, root, .006)
    cylinder('Trunk', (0, 0, .255), (0, 0, .797), .011, stem, root)
    for index, leaf in enumerate(leaves()):
        a = leaf['node']
        b = leaf_point(leaf, .045, 0)
        cylinder(f'Branch {index+1:02}', a, b, .005, stem, root)
        leaf_mesh(leaf, greens[index % len(greens)], root)
    return {'base_footprint': [1, 1], 'leaf_count': len(leaves()),
            'leaf_thickness': .002, 'planter_open': True, 'maximum_height': .941}
