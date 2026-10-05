"""Editable tank, cabinet, aquatic plants and three enclosed fish."""
import math

import bmesh
import bpy
from mathutils import Matrix

from build_parts import box, finish, material, mesh, tube
from aquarium_layout import fish_poses, parts


def ellipsoid(name, center, radii, mat, root):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=center)
    obj = bpy.context.object
    obj.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, mat, root)


def glass_material():
    mat = bpy.data.materials.new('Aquarium pale aqua glass')
    mat.use_nodes = True
    mat.surface_render_method = 'BLENDED'
    mat.use_transparent_shadow = False
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    mix = nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = .10
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    tint = nodes.new('ShaderNodeEmission')
    tint.inputs['Color'].default_value = (.22, .46, .42, 1)
    mat.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
    mat.node_tree.links.new(tint.outputs[0], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs[0], output.inputs['Surface'])
    geometry = nodes.new('ShaderNodeNewGeometry')
    rear = nodes.new('ShaderNodeEmission')
    rear.inputs['Color'].default_value = (.24, .42, .37, 1)
    sides = nodes.new('ShaderNodeMixShader')
    mat.node_tree.links.new(geometry.outputs['Backfacing'], sides.inputs[0])
    mat.node_tree.links.new(mix.outputs[0], sides.inputs[1])
    mat.node_tree.links.new(rear.outputs[0], sides.inputs[2])
    mat.node_tree.links.new(sides.outputs[0], output.inputs['Surface'])
    return mat


def fish(pose, frame, palette, root):
    x, y, z = pose['center']
    sign = pose['direction']
    name = pose['name']
    body = ellipsoid(name+' body', (x, y, z), (.065, .025, .037), palette[pose['colour']], root)
    vertices = [(x-sign*.051, y-.008, z),
                (x-sign*.105, y-.014+(frame*2-1)*.007, z-.030),
                (x-sign*.105, y-.014+(frame*2-1)*.007, z+.030),
                (x-sign*.051, y+.008, z),
                (x-sign*.105, y+.014+(frame*2-1)*.007, z-.030),
                (x-sign*.105, y+.014+(frame*2-1)*.007, z+.030)]
    mesh(name+' tail', vertices, [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3),
                                (1, 2, 5, 4), (2, 0, 3, 5)], palette[pose['colour']], root)
    for side in (-1, 1):
        ellipsoid(name+f' eye {side}', (x+sign*.038, y+side*.021, z+.006),
                  (.006, .004, .006), palette['charcoal'], root)
    body['fish_frame'] = frame


def build(root, frame=0):
    colours = {'wood': (.22, .125, .062), 'door': (.265, .15, .075),
               'charcoal': (.042, .052, .055), 'edge': (.12, .22, .21),
               'sand': (.43, .39, .255), 'stone': (.24, .28, .235),
               'green': (.15, .29, .115), 'amber': (.78, .30, .06),
               'blue': (.07, .23, .48), 'coral': (.65, .14, .075)}
    palette = {name: material('Aquarium '+name, colour) for name, colour in colours.items()}
    palette['glass'] = glass_material()
    for part in parts():
        if part['material'] == 'glass':
            x, y, z = part['center']
            sx, sy, sz = part['size']
            if part['name'].startswith('Glass long'):
                vertices = [(-sx/2, y, z-sz/2), (sx/2, y, z-sz/2),
                            (sx/2, y, z+sz/2), (-sx/2, y, z+sz/2)]
                order = (0, 1, 2, 3) if y < 0 else (3, 2, 1, 0)
            else:
                vertices = [(x, -sy/2, z-sz/2), (x, sy/2, z-sz/2),
                            (x, sy/2, z+sz/2), (x, -sy/2, z+sz/2)]
                order = (0, 1, 2, 3) if x > 0 else (3, 2, 1, 0)
            mesh(part['name'], vertices, [order], palette['glass'], root)
            continue
        box(part['name'], part['center'], part['size'], palette[part['material']], root, part['bevel'])
    for index, (x, y, sx, sy, sz) in enumerate(((-.22, .18, .08, .06, .05),
                                              (.21, -.16, .075, .055, .055),
                                              (.27, .17, .045, .06, .035),
                                              (-.06, -.20, .05, .04, .025))):
        ellipsoid(f'Rock {index}', (x, y, .76+sz*.60), (sx, sy, sz), palette['stone'], root)
    for cluster, (x, y) in enumerate(((-.25, .17), (.25, .19))):
        for blade in range(5):
            angle = blade*math.tau/5
            tip = (x+math.cos(angle)*.052, y+math.sin(angle)*.043, .90+.022*(blade%3))
            plant = tube(f'Plant {cluster} blade {blade}', [(x, y, .755),
                 (x+math.cos(angle)*.020, y+math.sin(angle)*.018, .83), tip],
                 .009, palette['green'], root)
            bpy.ops.object.select_all(action='DESELECT')
            plant.select_set(True)
            bpy.context.view_layer.objects.active = plant
            bpy.ops.object.convert(target='MESH')
            topology = bmesh.new()
            topology.from_mesh(plant.data)
            bmesh.ops.remove_doubles(topology, verts=list(topology.verts), dist=1e-6)
            bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
            topology.to_mesh(plant.data)
            topology.free()
    for pose in fish_poses(frame):
        fish(pose, frame, palette, root)
    # The saved SE aquarium's doors face game +Y. Bake its -X authored front
    # into the parts; keep the registered camera and facing transforms intact.
    rotation = Matrix.Rotation(-math.pi/2, 4, 'Z')
    bpy.context.view_layer.update()
    for obj in root.children:
        obj.matrix_world = rotation @ obj.matrix_world
    return {'base_footprint': [1, 1], 'front': '-X', 'maximum_height': 1.61,
            'fish_count': 3, 'fish_frame': frame, 'watch_animation_unchanged': True}
