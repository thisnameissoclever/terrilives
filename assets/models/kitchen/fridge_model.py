"""Editable two-door refrigerator, with a real cavity and named hinge parents."""
import math

import bpy
from mathutils import Vector

from build_parts import box, cylinder, material
from fridge_geometry import HINGE, door_point


def hinge_group(name, root):
    hinge = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = (*HINGE, 0)
    return hinge


def attach(obj, hinge):
    # Builders author in the refrigerator's local coordinates. The hinge owns
    # only door parts; changing its angle cannot drag the case or other door.
    obj.parent = hinge
    obj.location -= hinge.location


def build(root):
    enamel = material('Fridge cool grey enamel', (.52,.56,.58))
    door_enamel = material('Fridge door soft grey enamel', (.60,.63,.63))
    liner = material('Fridge warm white liner', (.75,.73,.65))
    seal = material('Fridge charcoal seals', (.055,.065,.067))
    brass = material('Fridge muted brass handles', (.37,.28,.14))
    shelf = material('Fridge shelf edge', (.43,.49,.49))
    # Outside envelope: width .76, depth .80, height 1.62 model units.
    box('Case rear', (0,.345,.84), (.76,.07,1.56), enamel,root,.025)
    for sign in (-1,1):
        box(f'Case side {sign}', (sign*.355,-.025,.84), (.05,.74,1.56),enamel,root,.018)
    box('Case top',(0,-.025,1.595),(.76,.74,.05),enamel,root,.02)
    box('Case base',(0,-.025,.105),(.71,.74,.07),enamel,root,.015)
    box('Interior back liner',(0,.295,.85),(.64,.025,1.40),liner,root,.012)
    box('Compartment divider',(0,-.025,1.165),(.665,.68,.04),liner,root,.008)
    for z in (.19,.48,.80):
        box(f'Food shelf {z}',(0,-.035,z),(.655,.64,.025),liner,root,.006)
        box(f'Shelf front lip {z}',(0,-.352,z+.014),(.655,.02,.045),shelf,root,.005)
    box('Lower toe kick',(0,-.390,.105),(.67,.027,.085),seal,root,.01)
    for x in (-.285,.285):
        for y in (-.29,.28):
            cylinder(f'Levelling foot {x} {y}',(x,y,0),(x,y,.09),.028,seal,root)
    # A plain recessed rear panel and lower vent identify the actual back.
    box('Rear service panel',(0,.383,.80),(.58,.012,1.23),shelf,root,.016)
    for z in (.22,.255,.29,.325):
        box(f'Rear vent slot {z}',(0,.393,z),(.43,.008,.012),seal,root,.003)
    hinges = []
    for label,z,height,handle_z,handle_height in (
        ('Refrigerator',.652,1.016,.69,.36),
        ('Freezer',1.378,.396,1.38,.21),
    ):
        hinge = hinge_group(label+' right hinge',root)
        hinges.append(hinge)
        for obj in (
            box(label+' door seal',(0,-.397,z),(.674,.015,height-.018),seal,root,.009),
            box(label+' door',(0,-.430,z),(.70,.060,height),door_enamel,root,.022),
            box(label+' inner liner',(0,-.394,z),(.625,.02,height-.07),liner,root,.009),
        ):
            attach(obj,hinge)
        for end in (-1,1):
            mount = cylinder(label+f' handle mount {end}',(-.245,-.452,handle_z+end*handle_height/2),
                             (-.245,-.491,handle_z+end*handle_height/2),.014,brass,root)
            attach(mount,hinge)
        handle = cylinder(label+' handle',(-.245,-.491,handle_z-handle_height/2),
                          (-.245,-.491,handle_z+handle_height/2),.018,brass,root)
        attach(handle,hinge)
    bpy.context.view_layer.update()
    # Check the actual scene transform against the independent hinge contract.
    for hinge in hinges:
        for angle in (0,45,90):
            hinge.rotation_euler.z = math.radians(angle)
            bpy.context.view_layer.update()
            actual = hinge.matrix_world @ Vector((-.60,-.07,.70))
            assert (actual-Vector(door_point((-.60,-.07,.70),angle))).length < 1e-6
        hinge.rotation_euler.z = 0
    return hinges
