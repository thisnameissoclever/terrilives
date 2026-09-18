"""Four-burner enamel range with a hollow oven and a bottom-hinged door."""
import math

import bpy
from mathutils import Vector

from build_parts import box, cylinder, finish, material
from stove_geometry import HINGE, door_point


def burner_ring(name, x, y, radius, mat, root):
    bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=12,
                                    location=(x,y,.873), major_radius=radius,
                                    minor_radius=.009)
    obj = bpy.context.object
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return finish(obj,name,mat,root)


def build(root):
    enamel = material('Range blue grey enamel',(.46,.52,.56))
    front = material('Range front soft grey',(.54,.59,.60))
    porcelain = material('Range warm cream porcelain',(.80,.77,.68))
    charcoal = material('Range charcoal metal',(.045,.053,.056))
    glass = material('Range smoked oven glass',(.065,.105,.115))
    steel = material('Range brushed steel',(.32,.38,.40))
    brass = material('Range muted brass controls',(.42,.31,.14))
    liner = material('Range oven liner',(.10,.12,.13))
    # One tile, matching the existing cabinet run's .86 worktop height.
    for sign in (-1,1):
        box(f'Range side {sign}',(sign*.435,0,.445),(.05,.90,.77),enamel,root,.012)
    box('Range back',(0,.435,.445),(.87,.05,.77),enamel,root,.012)
    box('Oven floor',(0,0,.19),(.82,.84,.04),liner,root,.008)
    box('Oven ceiling',(0,0,.755),(.82,.84,.04),liner,root,.008)
    box('Oven rear liner',(0,.397,.455),(.80,.018,.49),liner,root,.008)
    for z in (.32,.50):
        for x in (-.30,-.20,-.10,0,.10,.20,.30):
            cylinder(f'Oven shelf {z} rod {x}',(x,-.39,z),(x,.38,z),.008,steel,root)
        for y in (-.39,.38):
            cylinder(f'Oven shelf {z} edge {y}',(-.34,y,z),(.34,y,z),.01,steel,root)
    box('Range toe kick',(0,0,.075),(.83,.79,.15),charcoal,root,.012)
    box('Range lower drawer',(0,-.458,.13),(.83,.028,.115),front,root,.01)
    box('Range porcelain hob',(0,0,.825),(1,1,.07),porcelain,root,.018)
    burners = []
    for x,y,radius in ((-.235,-.23,.135),(.235,-.23,.11),(-.235,.22,.11),(.235,.22,.135)):
        base = cylinder(f'Burner well {x} {y}',(x,y,.855),(x,y,.865),radius+.016,charcoal,root)
        for polygon in base.data.polygons:
            polygon.use_smooth = abs(polygon.normal.z) < .5
        burners.append(base)
        for fraction in (.40,.70,1):
            burner_ring(f'Burner coil {x} {y} {fraction}',x,y,radius*fraction,steel,root)
    box('Range rear upstand',(0,.448,.937),(.97,.08,.155),enamel,root,.015)
    box('Range controls',(0,-.46,.776),(.86,.055,.098),enamel,root,.01)
    for x in (-.30,-.10,.10,.30):
        cylinder(f'Range control {x}',(x,-.478,.777),(x,-.515,.777),.031,brass,root)
        box(f'Range control indicator {x}',(x,-.516,.789),(.005,.005,.022),charcoal,root,.001)
    box('Rear service panel',(0,.468,.455),(.69,.012,.55),steel,root,.012)
    for z in (.21,.25,.29):
        box(f'Rear cooling vent {z}',(0,.477,z),(.51,.007,.009),charcoal,root,.002)

    hinge = bpy.data.objects.new('Oven bottom hinge',None)
    bpy.context.scene.collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = HINGE
    door_parts = [
        box('Oven door gasket',(0,-.458,.444),(.82,.02,.532),charcoal,root,.012),
        box('Oven door',(0,-.482,.444),(.80,.042,.510),front,root,.017),
        box('Oven window trim',(0,-.507,.434),(.61,.012,.305),charcoal,root,.025),
        box('Oven window glass',(0,-.516,.434),(.56,.01,.255),glass,root,.018),
    ]
    for x in (-.29,.29):
        door_parts.append(cylinder(f'Oven handle mount {x}',(x,-.50,.65),(x,-.551,.65),.015,steel,root))
    door_parts.append(cylinder('Oven handle',(-.32,-.551,.65),(.32,-.551,.65),.021,brass,root))
    for obj in door_parts:
        obj.parent = hinge
        obj.location -= hinge.location
    bpy.context.view_layer.update()
    for angle in (0,45,90):
        hinge.rotation_euler.x = math.radians(angle)
        bpy.context.view_layer.update()
        actual = hinge.matrix_world @ Vector((.25,-.055,.55))
        assert (actual-Vector(door_point((.25,-.055,.55),angle))).length < 1e-6
    hinge.rotation_euler.x = 0
    bpy.context.view_layer.update()
    assert len(burners) == 4
    assert len({tuple(round(v,5) for v in obj.location[:2]) for obj in burners}) == 4
    return [hinge]
