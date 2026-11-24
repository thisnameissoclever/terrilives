"""Candidate rail mesh with an explicit X-aligned cross-section and retained path."""
import math
import bpy
from mathutils import Vector
from build_parts import mesh, tube

PROFILE = 14
STEPS = 12


def fitted_rail(name, points, radius, material, root):
    """Build the visible tube from its actual editable Bezier control path."""
    path = tube(name+' authoring path', points, radius, material, root)
    path.hide_render = True
    path['pool_rail_authoring_path'] = True
    bpy.context.view_layer.update()
    path.hide_viewport = True
    controls = path.data.splines[0].bezier_points
    rings = []
    for segment in range(len(controls)-1):
        a, b = controls[segment], controls[segment+1]
        p0, p1, p2, p3 = [Vector(v) for v in (a.co,a.handle_right,b.handle_left,b.co)]
        for step in range(STEPS+(1 if segment==len(controls)-2 else 0)):
            t=step/STEPS
            if step==0:
                center=Vector(a.co)
            elif step==STEPS:
                center=Vector(b.co)
            else:
                center=(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3
            # The planar path has one X coordinate, independent of polynomial rounding.
            center.x=p0.x
            tangent=3*(1-t)**2*(p1-p0)+6*(1-t)*t*(p2-p1)+3*t*t*(p3-p2)
            if tangent.y==0 and tangent.z==0:
                raise ValueError('Candidate rail has an undefined path tangent')
            if any(p.x!=p0.x for p in (p1,p2,p3)):
                raise ValueError('Candidate rail path leaves its constant-X plane')
            normal=Vector((0,tangent.z,-tangent.y)).normalized()
            ring=[]
            for index in range(PROFILE):
                if index==0:
                    offset=Vector((radius,0,0))
                elif index==PROFILE//2:
                    offset=Vector((-radius,0,0))
                else:
                    angle=2*math.pi*index/PROFILE
                    offset=Vector((radius*math.cos(angle),0,0))+normal*(radius*math.sin(angle))
                ring.append(tuple(center+offset))
            rings.append(ring)
    if len(rings)!=73:
        raise ValueError('Candidate rail must retain its 73 authored rings')
    vertices=[*rings[0],*rings[-1],*(point for ring in rings for point in ring)]
    faces=[(0,index+2,index+1) for index in range(PROFILE-2)]
    faces.extend((PROFILE,PROFILE+index+1,PROFILE+index+2) for index in range(PROFILE-2))
    for ring in range(len(rings)-1):
        start=(ring+2)*PROFILE
        following=start+PROFILE
        for segment in range(PROFILE):
            previous=(segment+PROFILE-1)%PROFILE
            faces.extend(((start+segment,following+segment,following+previous),
                          (start+segment,following+previous,start+previous)))
    result=mesh(name,vertices,faces,material,root)
    result['pool_rail_path']=path.name
    for polygon in result.data.polygons:
        polygon.use_smooth=polygon.index>=2*(PROFILE-2)
    return result
