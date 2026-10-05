"""Require full body clearance and a finite hip support area on each seat."""
from pathlib import Path
import sys
import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE),str(BASE.parent/'living')]
from pose_profiles import PROFILES
from armchair_contact import body_inventory, evaluated_surface, intersection
from armchair_support import contact_footprint


def support(points, seat, kind, deps):
    evaluated = seat.evaluated_get(deps)
    inverse = evaluated.matrix_world.inverted()
    gaps,near = [],[]
    for point in points:
        hit,position,_,_ = evaluated.ray_cast(inverse@Vector((point.x,point.y,2)),
                                            inverse.to_3x3()@Vector((0,0,-1)))
        if not hit: continue
        gap = point.z-(evaluated.matrix_world@position).z
        gaps.append(gap)
        if 0<=gap<=.01:
            local = inverse@point
            near.append(Vector((local.y,-local.x,local.z)) if kind=='reading' else local)
    if not gaps or not 0<=min(gaps)<=.003:
        raise ValueError('Hip lacks non-penetrating support')
    return dict(min_gap=min(gaps),ray_hits=len(gaps),contact_count=len(near),
                **contact_footprint(near))


def measure(root,rig,kind):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    names = body_inventory()
    bodies = {name:evaluated_surface(bpy.data.objects[name],deps) for name in names}
    solids = {obj.name:evaluated_surface(obj,deps) for obj in root.children_recursive
              if obj.type=='MESH'}
    if not solids: raise ValueError('Seat has no evaluated furniture solids')
    for name,body in bodies.items():
        for other,solid in solids.items():
            if intersection(body,solid): raise ValueError(f'{name} intersects {other}')
    hip = support(bodies['Trouser hip bridge'][0],bpy.data.objects[PROFILES[kind]['seat']],kind,deps)
    soles = {name:min(point.z for point in bodies[name][0])
             for name in ('Fitted rounded shoe sole','Fitted rounded shoe sole.001')}
    if any(not .0185<=z<=.0198 for z in soles.values()):
        raise ValueError('Seat pose changed inherited shoe clearance')
    errors = {bone.name:abs((bone.tail-bone.head).length-rig.data.bones[bone.name].length)
              for bone in rig.pose.bones}
    if len(errors)!=17 or max(errors.values())>.00001:
        raise ValueError('Seated pose changes anatomical bone lengths')
    props = [obj.name for obj in bpy.data.objects if obj.type=='MESH' and
             ('book' in obj.name.lower() or 'spoon' in obj.name.lower()) and not obj.hide_render]
    if props: raise ValueError('Media sitting retains a reading or eating prop')
    return dict(body_parts=sorted(names),furniture_solids=sorted(solids),collisions=[],
                hip_support=hip,sole_clearance=soles,bone_length_errors=errors)
