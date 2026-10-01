"""Small ceramic dishes in the shared character and furniture model scale."""
import math

import bpy


def material(name, color):
    source = bpy.data.materials['Washed sage overshirt']
    result = source.copy()
    result.name = name
    base = tuple(source.diffuse_color)
    result.diffuse_color = (*color, 1)
    for node in result.node_tree.nodes:
        if node.type == 'VALTORGB':
            for stop in node.color_ramp.elements:
                old = tuple(stop.color)
                stop.color = tuple(color[i] * old[i] / max(base[i], .0001)
                                   for i in range(3)) + (1,)
    return result


def mesh(name, vertices, faces, mat, parent):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mat)
    return obj


def lathe(name, profile, mat, parent, origin=(0, 0, 0)):
    segments = 64
    vertices = [(origin[0] + radius * math.cos(i * math.tau / segments),
                 origin[1] + radius * math.sin(i * math.tau / segments),
                 origin[2] + z) for radius, z in profile for i in range(segments)]
    faces = [(row * segments + i, row * segments + (i + 1) % segments,
              (row + 1) * segments + (i + 1) % segments, (row + 1) * segments + i)
             for row in range(len(profile) - 1) for i in range(segments)]
    obj = mesh(name, vertices, faces, mat, parent)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def patch(name, points, z, mat, parent):
    return mesh(name, [(x, y, z) for x, y in points], [tuple(range(len(points)))], mat, parent)


def spoon(parent, mat, z=.02):
    # A broad head and narrow handle remain legible after reduction to game scale.
    outline = [(-.014, -.13), (.014, -.13), (.012, .048), (.037, .082),
               (.034, .118), (0, .135), (-.034, .118), (-.037, .082), (-.012, .048)]
    obj = patch('Used wooden spoon', outline, z, mat, parent)
    solid = obj.modifiers.new('Utensil thickness', 'SOLIDIFY')
    solid.thickness = .008
    obj.rotation_euler.z = -.65
    return obj


def plate(parent, cream, base=0):
    # A 30 cm plate with a shallow well, thin rim, and a contacting foot ring.
    return lathe('Ceramic dinner plate', [
        (0, .008), (.055, .008), (.055, 0), (.072, 0), (.075, .008),
        (.11, .011), (.144, .021), (.15, .024), (.15, .029),
        (.141, .032), (.108, .020), (.097, .017), (0, .017),
    ], cream, parent, (0, 0, base))


def build(parent, kind):
    cream = material('Warm ivory ceramic', (.78, .77, .71))
    residue = material('Dried sauce residue', (.37, .19, .10))
    wood = material('Used spoon wood', (.46, .29, .13))
    plate(parent, cream)
    base = .018 if kind == 'pair' else .036 if kind == 'prep_large' else 0
    if base:
        for level in range(1, round(base / .018) + 1):
            plate(parent, cream, level * .018)
    if kind in ('prep', 'prep_large'):
        lathe('Used preparation bowl', [
            (0, .010), (.050, .010), (.050, 0), (.065, 0), (.070, .014),
            (.10, .045), (.127, .099), (.127, .106), (.116, .106),
            (.090, .047), (.055, .020), (0, .020),
        ], cream, parent, (0, 0, .017 + base))
        spoon(parent, wood, .122 + base)
        patch('Bowl residue', [(-.04, -.03), (.028, -.05), (.056, -.018),
                              (.035, .015), (-.034, .008)], .041 + base, residue, parent)
    elif kind == 'meal':
        grain = material('Cooked grains', (.68, .53, .29))
        greens = material('Cooked vegetables', (.27, .37, .13))
        lathe('Main serving', [(0, 0), (.062, 0), (.075, .009), (.048, .028), (0, .032)],
              grain, parent, (-.036, -.021, .018))
        for x, y in ((.039, -.047), (.064, -.006), (.038, .026)):
            lathe('Vegetable piece', [(0, 0), (.025, 0), (.029, .013), (0, .031)],
                  greens, parent, (x, y, .018))
    else:
        patch('Sauce smear', [(-.073, -.02), (-.025, -.063), (.022, -.056),
                             (.015, -.039), (-.013, -.023), (-.05, .006)],
              .018 + base, residue, parent)
        patch('Small food remnant', [(.045, .023), (.071, .019), (.078, .041),
                                    (.057, .052), (.042, .041)], .018 + base, residue, parent)
    return {'diameter': .30, 'base_z': 0, 'kind': kind}
