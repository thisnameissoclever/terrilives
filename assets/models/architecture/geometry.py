"""Architecture in game coordinates: X/Y on the floor, Z up, origin on a wall line."""
from dataclasses import dataclass, replace
import math
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from architecture_dimensions import WALL_AND_DOOR_DEPTH

WALL_HEIGHT = 2.0
WALL_THICKNESS = WALL_AND_DOOR_DEPTH
BASEBOARD_HEIGHT = 0.14
CUT_HEIGHT = WALL_HEIGHT / 3
HALF_WIDTH = 32
HALF_HEIGHT = 21
VERTICAL_UNIT = 38


@dataclass(frozen=True)
class Box:
    name: str
    lower: tuple
    upper: tuple
    material: str
    bevel: float = 0


def window_span(width):
    if type(width) is not int or width not in (1, 2, 3):
        raise ValueError('Window width must be 1, 2 or 3 wall units')
    return float(width)


def project(point):
    x, y, z = point
    return ((x-y)*HALF_WIDTH, (x+y)*HALF_HEIGHT-z*VERTICAL_UNIT)


def box(name, x0, x1, y0, y1, z0, z1, material, bevel=0):
    assert x1 > x0 and y1 > y0 and z1 > z0
    return Box(name, (x0,y0,z0), (x1,y1,z1), material, bevel)


def clip(parts, height):
    """A physical cut removes the upper frame and leaves a closed cut face."""
    return [replace(p, upper=(*p.upper[:2], min(p.upper[2], height)))
            for p in parts if p.lower[2] < height]


def rotate(parts):
    """A real quarter-turn, with the wall origin fixed."""
    return [replace(p, lower=(-p.upper[1],p.lower[0],p.lower[2]),
                    upper=(-p.lower[1],p.upper[0],p.upper[2])) for p in parts]


def translate(parts, x, y):
    return [replace(p, lower=(p.lower[0]+x,p.lower[1]+y,p.lower[2]),
                    upper=(p.upper[0]+x,p.upper[1]+y,p.upper[2])) for p in parts]


def wall(width, openings=()):
    """Partition solids at openings; the Blender builder joins coplanar faces."""
    half = WALL_THICKNESS/2
    xs = sorted(set([-width/2,width/2]+[v for a,b,_,_ in openings for v in (a,b)]))
    zs = sorted(set([0,WALL_HEIGHT]+[v for _,_,a,b in openings for v in (a,b)]))
    parts = []
    for x0,x1 in zip(xs,xs[1:]):
        for z0,z1 in zip(zs,zs[1:]):
            if any(a <= (x0+x1)/2 <= b and c <= (z0+z1)/2 <= d for a,b,c,d in openings):
                continue
            parts.append(box('Plaster',x0,x1,-half,half,z0,z1,'plaster'))
    for x0,x1 in zip(xs,xs[1:]):
        if any(a <= (x0+x1)/2 <= b and c == 0 for a,b,c,d in openings):
            continue
        for side in (-1,1):
            a,b = sorted((side*half,side*(half+.018)))
            parts.append(box('Baseboard',x0,x1,a,b,0,BASEBOARD_HEIGHT,'trim',.003))
    return parts


def window(width, model, center=0):
    window_span(width)
    if (model,width) not in (('sash',1),('sliding',2),('picture',3)):
        raise ValueError('This review contains only the approved Sash, Sliding and Picture widths')
    x0,x1 = center-width/2+.14,center+width/2-.14
    z0,z1 = .65,1.82
    material = {'sash':'cream','sliding':'steel','picture':'bronze'}[model]
    parts = []
    # Reveal liner stays inside the opening. Trim surrounds both physical faces.
    for side in (-1,1):
        ya,yb = sorted((side*(WALL_THICKNESS/2-.012),side*(WALL_THICKNESS/2+.018)))
        for x in (x0,x1-.055):
            parts.append(box('Frame upright',x,x+.055,ya,yb,z0,z1,material,.006))
        for z in (z0,z1-.055):
            parts.append(box('Frame rail',x0,x1,ya,yb,z,z+.055,material,.006))
    parts += [box('Recessed glass',x0+.055,x1-.055,-.009,.009,z0+.055,z1-.055,'glass',.002),
              box('Stone sill',x0-.05,x1+.05,-.125,.125,z0-.055,z0+.01,'trim',.009)]
    if model == 'sash':
        parts.append(box('Meeting rail',x0+.045,x1-.045,-.036,.036,1.215,1.265,material,.004))
    if model == 'sliding':
        parts.append(box('Overlapping center rail',center-.028,center+.028,-.04,.04,z0+.045,z1-.045,material,.005))
        parts.append(box('Center handle',center+.04,center+.056,.04,.065,1.09,1.29,'steel',.004))
    return parts, (x0,x1,z0,z1)


def window_wall(width, model):
    frame, opening = window(width,model)
    return wall(width,[opening])+frame


def doorway(width=1):
    aperture = (-.4,.4,0,1.75)
    parts = wall(width,[aperture])
    for side in (-1,1):
        ya,yb=sorted((side*(WALL_THICKNESS/2),side*(WALL_THICKNESS/2+.02)))
        for x in (-.435,.4):
            parts.append(box('Door casing',x,x+.035,ya,yb,0,1.785,'trim',.005))
        parts.append(box('Door lintel casing',-.435,.435,ya,yb,1.75,1.785,'trim',.005))
    return parts


def corner():
    # One closed L, extending half a unit on each positive axis. The overlap
    # belongs to the X arm, so a shared corner never draws two transparent faces.
    parts=translate(wall(.56),.22,0)
    parts += translate(rotate(wall(.44)),0,.28)
    return parts


def floor(material):
    if material not in ('oak','tile','carpet'):
        raise ValueError('Unknown review floor')
    return [box('Floor surface',-.5,.5,-.5,.5,-.012,0,material)]


def room_wall(axis):
    if axis == 'x':
        frame,opening=window(3,'picture',.0)
        return wall(6,[opening])+frame
    sash,a=window(1,'sash',-1.75)
    sliding,b=window(2,'sliding',.75)
    return rotate(wall(6,[a,b])+sash+sliding)


def depth_from_point(point):
    return point[0]+point[1]


def visible_box_hit(origin, direction, parts):
    """Independent slab intersection for registration tests and depth witnesses."""
    nearest = None
    for p in parts:
        near,far=-math.inf,math.inf
        for axis in range(3):
            if abs(direction[axis]) < 1e-12:
                if not p.lower[axis] <= origin[axis] <= p.upper[axis]:
                    far=-math.inf
                    break
            else:
                a=(p.lower[axis]-origin[axis])/direction[axis]
                b=(p.upper[axis]-origin[axis])/direction[axis]
                near,far=max(near,min(a,b)),min(far,max(a,b))
        if far >= max(near,0) and (nearest is None or near < nearest[0]):
            nearest=(near,tuple(origin[i]+near*direction[i] for i in range(3)),p.name)
    return nearest
