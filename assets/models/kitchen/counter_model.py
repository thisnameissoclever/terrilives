"""Matching cabinet and sink unit, with a real worktop cutout and basin."""
import bpy
from mathutils import Vector

from build_parts import box, cylinder, material, mesh, tube
from counter_geometry import worktop_mesh, basin_mesh


def build(root, sink=False):
    enamel = material('Cabinet blue grey enamel',(.46,.52,.56))
    front = material('Cabinet front soft grey',(.54,.59,.60))
    porcelain = material('Cabinet warm cream worktop',(.80,.77,.68))
    charcoal = material('Cabinet charcoal plinth',(.045,.053,.056))
    brass = material('Cabinet muted brass handle',(.42,.31,.14))
    steel = material('Sink satin steel',(.43,.49,.51))
    for sign in (-1,1):
        box(f'Cabinet side {sign}',(sign*.435,0,.45),(.05,.90,.68),enamel,root,.012)
    box('Cabinet back',(0,.435,.45),(.87,.05,.68),enamel,root,.012)
    box('Cabinet base',(0,0,.14),(.83,.85,.06),enamel,root,.008)
    box('Cabinet inset toe kick',(0,.025,.065),(.83,.78,.13),charcoal,root,.012)
    box('Cabinet door reveal',(0,-.444,.45),(.85,.015,.666),charcoal,root,.008)
    door = box('Cabinet door',(0,-.462,.45),(.825,.034,.638),front,root,.014)
    for z in (.37,.53):
        cylinder(f'Cabinet handle mount {z}',(-.29,-.475,z),(-.29,-.515,z),.012,brass,root)
    cylinder('Cabinet handle',(-.29,-.515,.355),(-.29,-.515,.545),.017,brass,root)
    top = mesh('Cream worktop',*worktop_mesh(sink),porcelain,root)
    # Face normals keep the top flat; a small bevel softens its perimeter.
    bevel = top.modifiers.new('Soft worktop edge','BEVEL')
    bevel.width = .006
    bevel.segments = 3
    top.modifiers.new('Weighted worktop normals','WEIGHTED_NORMAL')
    result = {'worktop_height':.86,'sink':sink,'cabinet_front':'-Y'}
    if sink:
        bowl = mesh('Recessed steel basin',*basin_mesh(),steel,root)
        solid = bowl.modifiers.new('Basin sheet thickness','SOLIDIFY')
        solid.thickness = .005
        solid.offset = -1
        bowl.modifiers.new('Weighted basin normals','WEIGHTED_NORMAL')
        cylinder('Sink drain',(0,-.04,.629),(0,-.04,.636),.035,charcoal,root)
        cylinder('Faucet mounting flange',(0,.36,.859),(0,.36,.880),.052,steel,root)
        tube('Sink curved faucet',[(0,.36,.875),(0,.36,1.075),(0,.325,1.155),
                                  (0,.235,1.18),(0,.13,1.15),(0,.11,1.10)],
             .021,steel,root)
        cylinder('Faucet lever base',(.105,.36,.859),(.105,.36,.903),.028,steel,root)
        cylinder('Faucet lever',(.105,.36,.895),(.105,.31,.955),.012,brass,root)
        bpy.context.view_layer.update()
        # Trace the actual saved geometry, not just the source's dimensions.
        origin,down = Vector((0,-.04,1.3)),Vector((0,0,-1))
        assert not top.ray_cast(origin,down)[0], 'Worktop must not cap the sink opening'
        hit,point,_,_ = bowl.ray_cast(origin,down)
        assert hit and abs(point.z-.63)<1e-5, 'Basin floor must be recessed'
        result['sink_floor'] = point.z
        result['opening_ray_clear'] = True
        hit,point,_,_ = bowl.ray_cast(Vector((0,.11,1.10)),down)
        assert hit and .629 < point.z < .64, 'Faucet outlet must drain into the basin'
        result['faucet_drains_into_basin'] = True
    else:
        bpy.context.view_layer.update()
        hit,point,_,_ = top.ray_cast(Vector((0,0,1.3)),Vector((0,0,-1)))
        assert hit and abs(point.z-.86)<1e-5, 'Plain counter needs a solid worktop'
        result['central_surface_supported'] = True
    assert door.parent == root
    return result
