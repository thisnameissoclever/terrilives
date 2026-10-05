"""Editable tank, cabinet, aquatic plants and three enclosed fish."""
import math

import bpy

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
    mix.inputs[0].default_value = .19
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    tint = nodes.new('ShaderNodeEmission')
    tint.inputs['Color'].default_value = (.22, .46, .42, 1)
    mat.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
    mat.node_tree.links.new(tint.outputs[0], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs[0], output.inputs['Surface'])
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
               'green': (.15, .29, .115), 'amber': (.67, .32, .10),
               'blue': (.12, .29, .43), 'coral': (.53, .20, .12)}
    palette = {name: material('Aquarium '+name, colour) for name, colour in colours.items()}
    palette['glass'] = glass_material()
    for part in parts():
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
            tube(f'Plant {cluster} blade {blade}', [(x, y, .755),
                 (x+math.cos(angle)*.020, y+math.sin(angle)*.018, .83), tip],
                 .009, palette['green'], root)
    for pose in fish_poses(frame):
        fish(pose, frame, palette, root)
    return {'base_footprint': [1, 1], 'front': '-Y', 'maximum_height': 1.42,
            'fish_count': 3, 'fish_frame': frame, 'watch_animation_unchanged': True}
