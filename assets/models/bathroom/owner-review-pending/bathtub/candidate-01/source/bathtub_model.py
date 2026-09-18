"""Warm enamel bathtub, inset floor support and deck-mounted satin fittings."""
from build_parts import box, cylinder, material, mesh, tube
from bathtub_geometry import ceramic_tub


def build(root):
    ceramic = material('Bathtub warm enamel',(.75,.75,.69))
    metal = material('Bathtub satin fittings',(.42,.49,.50))
    dark = material('Bathtub recessed plinth',(.18,.21,.21))
    shell = mesh('Bathtub continuous shell',*ceramic_tub(),ceramic,root)
    bevel = shell.modifiers.new('Soft enamel edges','BEVEL')
    bevel.width = .008
    bevel.segments = 4
    shell.modifiers.new('Enamel weighted normals','WEIGHTED_NORMAL')
    box('Bathtub inset plinth',(0,-.5,.04),(.56,1.48,.08),dark,root,.015)
    cylinder('Bathtub drain',(0,-.02,.146),(0,-.02,.155),.035,metal,root)
    cylinder('Bathtub overflow',(0,.194,.49),(0,.177,.495),.027,metal,root)
    cylinder('Bathtub tap foot',(0,.33,.564),(0,.33,.595),.04,metal,root)
    tube('Bathtub curved spout',[(0,.33,.58),(0,.33,.70),
         (0,.26,.735),(0,.12,.715),(0,.11,.67)],.019,metal,root)
    for x in (-.135,.135):
        cylinder(f'Bathtub tap base {x}',(x,.33,.564),(x,.33,.596),.036,metal,root)
        cylinder(f'Bathtub tap stem {x}',(x,.33,.584),(x,.33,.636),.018,metal,root)
        cylinder(f'Bathtub tap handle {x}',(x-.036,.33,.628),(x+.036,.33,.628),.013,metal,root)
    return {'footprint':[2,1], 'authored_facing':'SE', 'canonical_center_y':-.5,
            'shell_bounds':[.82,1.84,.57], 'basin_floor_z':.15,
            'water':False, 'bathing_pose':False,
            'other_facings':'source views; gameplay footprint does not rotate'}
