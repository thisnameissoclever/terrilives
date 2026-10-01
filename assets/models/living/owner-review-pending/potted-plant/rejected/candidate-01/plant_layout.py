"""A small broad-leaf plant in a tapered square terracotta planter."""
import math


def leaves():
    specs = [(0, .40, .25, .077, .10), (140, .44, .26, .08, .09),
             (255, .49, .25, .077, .12), (60, .54, .25, .08, .13),
             (190, .59, .24, .077, .11), (310, .64, .23, .072, .12),
             (105, .69, .22, .075, .13), (225, .74, .18, .063, .12),
             (25, .79, .15, .057, .15)]
    return [dict(name=f'Leaf {index+1:02}', angle=math.radians(angle),
                 root=(.055*math.cos(math.radians(angle)),
                       .055*math.sin(math.radians(angle)), height),
                 node=(0, 0, height-.035), length=length, width=width, rise=rise)
            for index, (angle, height, length, width, rise) in enumerate(specs)]


def leaf_point(leaf, t, u):
    root, angle = leaf['root'], leaf['angle']
    if t == 0:
        return root
    taper = math.sin(math.pi*t) if t < 1 else 0
    along = leaf['length']*t
    across = leaf['width']*taper**.8*u
    return (root[0]+along*math.cos(angle)-across*math.sin(angle),
            root[1]+along*math.sin(angle)+across*math.cos(angle),
            root[2]+leaf['rise']*t+.028*taper-.018*taper*u*u)


def pot_geometry():
    profile = [(.135, 0), (.18, .285), (.18, .305),
               (.162, .305), (.158, .278), (.117, .055)]
    vertices = [(sx*radius, sy*radius, z) for radius, z in profile
                for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [(3, 2, 1, 0)]
    for ring in range(len(profile)-1):
        for side in range(4):
            i, j = ring*4+side, ring*4+(side+1)%4
            faces.append((i, j, j+4, i+4))
    faces.append((20, 21, 22, 23))
    return vertices, faces
