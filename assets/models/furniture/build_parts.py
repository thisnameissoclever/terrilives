"""Named, editable furniture geometry for the approved model-to-sprite workflow."""
import math

import bpy
from mathutils import Vector

from geometry import AXLE, HANDLE_RADIUS, HOUSING_HALF_WIDTH, MAT_TOP, pedal, towel_section


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
                stop.color = tuple(color[i] * old[i] / max(base[i], .0001) for i in range(3)) + (1,)
    return result


def finish(obj, name, mat, root):
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = root
    return obj


def box(name, center, size, mat, root, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Rounded manufactured edge', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 4
        obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    return finish(obj, name, mat, root)


def tube(name, points, radius, mat, root):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 12
    curve.bevel_depth = radius
    curve.bevel_resolution = 5
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for handle, point in zip(spline.bezier_points, points):
        handle.co = point
        handle.handle_left_type = 'AUTO'
        handle.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, root)


def cylinder(name, a, b, radius, mat, root):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=(b-a).length,
                                      location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    modifier = obj.modifiers.new('Soft metal edge', 'BEVEL')
    modifier.width = min(radius * .15, .012)
    modifier.segments = 3
    obj.modifiers.new('Weighted cylinder normals', 'WEIGHTED_NORMAL')
    return finish(obj, name, mat, root)


def mesh(name, vertices, faces, mat, root):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, root)


def saddle(mat, root):
    # Wide rear, narrow nose; the surface is not an oval viewed from every side.
    outline = [(-.18,.30),(-.20,.22),(-.13,.12),(-.065,-.04),
               (.065,-.04),(.13,.12),(.20,.22),(.18,.30)]
    vertices = [(x,y,z) for z in (.735,.805) for x,y in outline]
    faces = [tuple(reversed(range(8))), tuple(range(8,16))]
    faces += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    obj = mesh('Bike saddle', vertices, faces, mat, root)
    bevel = obj.modifiers.new('Padded saddle edge', 'BEVEL')
    bevel.width = .035
    bevel.segments = 5
    obj.modifiers.new('Weighted saddle normals', 'WEIGHTED_NORMAL')


def towel(cream, stripe, root):
    # One sheet wraps a Y-axis segment of the rider-right handle. Its two tails
    # hang on opposite X sides, not on the same side of the bar.
    vertices, faces = [], []
    rows, columns = 100, 20
    for row in range(rows + 1):
        t = row / rows
        x, z = towel_section(t)
        for col in range(columns + 1):
            u = col / columns
            wrinkle = .002 * math.sin(u * math.tau * 2) * abs(t - .5) * 2
            vertices.append((.255 + x + (1 if x > 0 else -1)*abs(wrinkle),
                             -.265 + .105 * (u-.5), 1.135 + z))
    for row in range(rows):
        for col in range(columns):
            start = row * (columns+1) + col
            faces.append((start, start+1, start+columns+2, start+columns+1))
    obj = mesh('Cream towel wrapped over right handle', vertices, faces, cream, root)
    obj.data.materials.append(stripe)
    for face in obj.data.polygons:
        row = face.index // columns
        face.material_index = int(row in (5,6,11,12,87,88,93,94))
        face.use_smooth = True
    solid = obj.modifiers.new('Cloth thickness away from tube', 'SOLIDIFY')
    solid.thickness = .002
    solid.offset = 0
    return obj


def bike(root):
    steel = material('Bike slate blue enamel', (.14,.20,.255))
    edge = material('Bike dark edge metal', (.035,.045,.05))
    rubber = material('Bike charcoal rubber', (.026,.030,.033))
    rim = material('Bike flywheel ring', (.21,.27,.32))
    screen = material('Bike muted cyan display', (.075,.34,.43))
    cream = material('Towel warm cream', (.74,.64,.48))
    stripe = material('Towel blue grey stripes', (.30,.41,.46))
    box('Bike floor mat', (0,0,.0125), (.91,.98,.025), rubber, root, .015)
    for y in (-.38,.37):
        cylinder(f'Bike stabilizer {y}', (-.33,y,.08), (.33,y,.08), .047, steel, root)
        for sign in (-1,1):
            cylinder(f'Bike stabilizer rubber cap {y} {sign}',
                     (sign*.30,y,.08),(sign*.37,y,.08),.056,rubber,root)
    box('Bike lower frame', (0,0,.13),(.10,.75,.10),edge,root)
    box('Bike flywheel housing', (0,-.015,.36),(.27,.65,.46),steel,root,.065)
    for sign in (-1,1):
        x = sign * HOUSING_HALF_WIDTH
        cylinder(f'Bike flywheel cover {sign}',(x,AXLE[1],AXLE[2]),
                 (x+sign*.023,AXLE[1],AXLE[2]),.215,rim,root)
        cylinder(f'Bike flywheel face {sign}',(x+sign*.023,AXLE[1],AXLE[2]),
                 (x+sign*.029,AXLE[1],AXLE[2]),.19,steel,root)
    cylinder('Bike transverse crank axle',(-.18,AXLE[1],AXLE[2]),
             (.18,AXLE[1],AXLE[2]),.038,edge,root)
    box('Bike seat post',(0,.22,.62),(.075,.085,.32),steel,root,.012)
    cylinder('Bike seat adjustment knob',(-.09,.22,.67),(-.13,.22,.67),.034,rubber,root)
    saddle(rubber,root)
    tube('Bike console mast',[(0,-.30,.51),(0,-.30,.78),(0,-.295,1.10)],.046,steel,root)
    tube('Bike lower handle crossbar',[(-.255,-.285,1.10),(0,-.285,1.10),(.255,-.285,1.10)],HANDLE_RADIUS,rubber,root)
    for side,sign in (('L',-1),('R',1)):
        cylinder(f'Bike towel support handle {side}',(sign*.255,-.195,1.135),
                 (sign*.255,-.335,1.135),HANDLE_RADIUS,rubber,root)
        tube(f'Bike swept handle {side}',[(sign*.255,-.335,1.135),
             (sign*.255,-.365,1.20),
             (sign*.255,-.415,1.32)],HANDLE_RADIUS,rubber,root)
    console = box('Bike console casing',(0,-.305,1.14),(.255,.17,.065),edge,root,.02)
    console.rotation_euler.x = math.radians(-30)
    display = box('Bike rider-facing screen',(0,-.288,1.170),(.19,.105,.005),screen,root,.009)
    display.rotation_euler.x = math.radians(-30)
    towel(cream,stripe,root)
    movable = []
    for side,sign in (('L',-1),('R',1)):
        point = pedal(side,0)
        arm = cylinder(f'Bike crank {side}',(sign*.18,AXLE[1],AXLE[2]),
                       (sign*.18,point[1],point[2]),.024,edge,root)
        platform = box(f'Bike pedal {side}',point,(.13,.16,.035),rubber,root,.009)
        spindle = cylinder(f'Bike pedal spindle {side}',
                           (sign*.18,point[1],point[2]),point,.018,edge,root)
        bpy.context.view_layer.update()
        transform = spindle.matrix_world.copy()
        spindle.parent = platform
        spindle.matrix_world = transform
        movable.append((side,arm,platform))
    return movable


def set_crank_phase(movable, phase):
    for side,arm,platform in movable:
        sign = -1 if side == 'L' else 1
        point = Vector(pedal(side,phase))
        start = Vector((sign*.18,AXLE[1],AXLE[2]))
        end = Vector((sign*.18,point.y,point.z))
        arm.location = (start+end)/2
        arm.rotation_euler = (end-start).to_track_quat('Z','Y').to_euler()
        platform.location = point


def chair(root):
    clay = material('Reading chair muted clay',(.40,.17,.105))
    cushion = material('Reading chair cushion',(.46,.205,.13))
    piping = material('Reading chair piping',(.26,.10,.065))
    wood = material('Reading chair walnut feet',(.075,.048,.032))
    for x in (-.30,.30):
        for y in (-.28,.29):
            box(f'Chair foot {x} {y}',(x,y,.13),(.095,.095,.26),wood,root,.012)
    box('Chair upholstered base',(0,.015,.29),(.75,.72,.18),clay,root,.065)
    box('Chair seat cushion',(0,-.025,.405),(.58,.56,.13),cushion,root,.055)
    back = box('Chair rear back',(0,.31,.79),(.68,.17,.84),clay,root,.072)
    back.rotation_euler.x = math.radians(5)
    inner = box('Chair padded inner back',(0,.205,.80),(.49,.12,.59),cushion,root,.065)
    inner.rotation_euler.x = math.radians(5)
    for side,sign in (('L',-1),('R',1)):
        box(f'Chair arm side {side}',(sign*.315,0,.44),(.14,.72,.36),clay,root,.05)
        box(f'Chair rolled arm {side}',(sign*.315,-.01,.635),(.17,.70,.16),cushion,root,.065)
        box(f'Chair wing {side}',(sign*.29,.20,.96),(.13,.28,.44),clay,root,.055)
        tube(f'Chair arm piping {side}',[(sign*.315,-.32,.65),
             (sign*.315,-.18,.705),(sign*.315,.23,.705)],.004,piping,root)
    for x in (-.13,.13):
        cylinder(f'Chair back button {x}',(x,.126,.88),(x,.118,.88),.014,piping,root)
    return []
