"""Patio umbrella: slate weighted base, pale wood pole, two-tone octagonal canopy."""
import bmesh

from build_parts import cylinder, material, mesh
import umbrella_layout as L


def canopy(cream, coral, root):
    vertices, faces, panels = L.canopy_geometry()
    obj = mesh('Umbrella canopy fabric', vertices, faces, cream, root)
    obj.data.materials.append(coral)
    for face, panel in zip(obj.data.polygons, panels):
        face.material_index = panel % 2
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(obj.data)
    topology.free()
    if obj.data.polygons[0].normal.z < 0:
        obj.data.flip_normals()
    solid = obj.modifiers.new('Fabric thickness', 'SOLIDIFY')
    solid.thickness = .008
    solid.offset = -1
    return obj


def build(root):
    slate = material('Umbrella slate weighted base', (.15, .16, .17))
    wood = material('Umbrella pale wood pole', (.50, .36, .21))
    bronze = material('Umbrella dark bronze fittings', (.07, .06, .05))
    cream = material('Umbrella cream canopy panels', (.72, .66, .52))
    coral = material('Umbrella muted coral canopy panels', (.56, .22, .15))

    cylinder('Umbrella weighted base', (0, 0, 0), (0, 0, L.BASE_HEIGHT),
             L.BASE_RADIUS, slate, root)
    cylinder('Umbrella base collar', (0, 0, L.BASE_HEIGHT-.01), (0, 0, L.COLLAR_TOP),
             L.COLLAR_RADIUS, bronze, root)
    cylinder('Umbrella pole', (0, 0, L.COLLAR_TOP-.02), (0, 0, L.FINIAL_BASE+.01),
             L.POLE_RADIUS, wood, root)
    cylinder('Umbrella tilt collar', (0, 0, L.TILT_COLLAR_Z[0]),
             (0, 0, L.TILT_COLLAR_Z[1]), L.TILT_COLLAR_RADIUS, bronze, root)
    canopy(cream, coral, root)
    cylinder('Umbrella finial cap', (0, 0, L.FINIAL_BASE), (0, 0, L.APEX_Z+.025),
             L.FINIAL_RADIUS, wood, root)
    cylinder('Umbrella finial knob', (0, 0, L.APEX_Z+.02), (0, 0, L.FINIAL_TOP),
             .026, wood, root)
    width, low, high = L.canopy_extent()
    return {'footprint': list(L.FOOTPRINT), 'base_diameter': 2*L.BASE_RADIUS,
            'canopy_width': width, 'canopy_low': low, 'canopy_high': high,
            'finial_top': L.FINIAL_TOP, 'canopy_sides': L.SIDES,
            'overhangs_tile': True}
