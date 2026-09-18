"""Editable pedestal sink with one continuous ceramic bowl and attached tap."""
import bpy
from mathutils import Vector

from build_parts import cylinder, material, mesh, tube
from counter_geometry import rounded_loop
from basin_geometry import ceramic_basin


def build(root):
    porcelain = material('Bathroom warm white ceramic',(.83,.82,.77))
    chrome = material('Bathroom satin chrome',(.43,.49,.51))
    dark = material('Bathroom drain dark steel',(.08,.095,.10))
    bowl = mesh('Bathroom ceramic basin',*ceramic_basin(),porcelain,root)
    bevel = bowl.modifiers.new('Rounded ceramic rim','BEVEL')
    bevel.width = .009
    bevel.segments = 4
    bowl.modifiers.new('Ceramic weighted normals','WEIGHTED_NORMAL')
    loops = [rounded_loop(x,y,r,z) for x,y,r,z in (
        (.15,.165,.055,0),(.15,.165,.055,.035),
        (.085,.10,.055,.39),(.14,.14,.06,.625))]
    n = len(loops[0])
    vertices = [point for loop in loops for point in loop]
    faces = [tuple(reversed(range(n))),tuple(range(3*n,4*n))]
    for layer in range(3):
        for i in range(n):
            j = (i+1)%n
            faces.append((layer*n+i,layer*n+j,(layer+1)*n+j,(layer+1)*n+i))
    pedestal = mesh('Bathroom ceramic pedestal',vertices,faces,porcelain,root)
    bevel = pedestal.modifiers.new('Soft pedestal transitions','BEVEL')
    bevel.width = .012
    bevel.segments = 4
    pedestal.modifiers.new('Pedestal weighted normals','WEIGHTED_NORMAL')
    cylinder('Bathroom drain',(0,-.055,.654),(0,-.055,.660),.028,dark,root)
    cylinder('Bathroom faucet flange',(0,.225,.819),(0,.225,.839),.043,chrome,root)
    tube('Bathroom faucet',[(0,.225,.832),(0,.225,.965),
                            (0,.155,1.025),(0,.035,1.01),(0,-.01,.965)],
         .018,chrome,root)
    cylinder('Bathroom lever hinge',(.0,.225,.864),(.055,.225,.864),.016,chrome,root)
    cylinder('Bathroom tap lever',(.05,.225,.859),(.05,.195,.925),.011,chrome,root)
    bpy.context.view_layer.update()
    down = Vector((0,0,-1))
    hit,point,_,_ = bowl.ray_cast(Vector((0,-.01,1.2)),down)
    assert hit and abs(point.z-.655)<1e-5, 'Spout must drain into the recessed floor'
    hit,point,_,_ = bowl.ray_cast(Vector((0,.225,1.2)),down)
    assert hit and abs(point.z-.82)<1e-5, 'Faucet needs solid ceramic deck'
    return {'basin_rim':.82,'basin_floor':.655,'pedestal_top':.625,
            'faucet_drains_into_basin':True,'front':'-Y'}
