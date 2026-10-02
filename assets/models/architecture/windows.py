"""Nine fixed-width windows. Frames and reveals are authored on both faces."""
from dataclasses import dataclass, replace
import math
from geometry import box, wall, window_wall, clip, rotate, CUT_HEIGHT

MODELS = {1:('sash',1), 2:('cottage',1), 3:('arched',1),
          4:('sliding',2), 5:('steel-grid',2), 6:('twin-casement',2),
          7:('picture',3), 8:('craftsman',3), 9:('clerestory',3)}
DIRECTIONS = {'x-front':0, 'y-front':1, 'x-back':2, 'y-back':3}


@dataclass(frozen=True)
class Prism:
    name: str
    polygon: tuple
    y0: float
    y1: float
    material: str
    turns: int = 0
    bevel: float = 0

    @property
    def vertices(self):
        points=[]
        for y in (self.y0,self.y1):
            for x,z in self.polygon:
                a,b=x,y
                for _ in range(self.turns): a,b=-b,a
                points.append((a,b,z))
        return points

    @property
    def lower(self): return tuple(min(p[i] for p in self.vertices) for i in range(3))

    @property
    def upper(self): return tuple(max(p[i] for p in self.vertices) for i in range(3))


def orient(parts, direction):
    result=parts
    for _ in range(DIRECTIONS[direction]):
        result=[replace(p,turns=(p.turns+1)%4) if isinstance(p,Prism) else rotate([p])[0] for p in result]
    return result


def cut(parts):
    # The arch begins well above the cut plane, so no curved polygon crosses it.
    assert all(not isinstance(p,Prism) or p.lower[2] >= CUT_HEIGHT for p in parts)
    return clip([p for p in parts if not isinstance(p,Prism)], CUT_HEIGHT)


def frame(width, material, z0=.65, z1=1.82):
    x0,x1=-width/2+.14,width/2-.14
    parts=[]
    for side in (-1,1):
        ya,yb=sorted((side*.048,side*.078))
        for x in (x0,x1-.055):
            parts.append(box('Frame upright',x,x+.055,ya,yb,z0,z1,material,.006))
        for z in (z0,z1-.055):
            parts.append(box('Frame rail',x0,x1,ya,yb,z,z+.055,material,.006))
    parts += [box('Recessed glass',x0+.055,x1-.055,-.009,.009,z0+.055,z1-.055,'glass',.002),
              box('Stone sill',x0-.05,x1+.05,-.125,.125,z0-.055,z0+.01,'trim',.009)]
    return parts,(x0,x1,z0,z1)


def bar(parts, x, z0, z1, material, width=.035, name='Vertical bar'):
    parts.append(box(name,x-width/2,x+width/2,-.035,.035,z0,z1,material,.003))


def arched():
    radius=.36; spring=1.46; bottom=.65; inner=radius-.055
    parts=wall(1,[(-radius,radius,bottom,1.82)])
    # Replace the rectangular opening's upper corners with connected arch infill.
    for i in range(24):
        a,b=math.pi*i/24,math.pi*(i+1)/24
        xa,xb=radius*math.cos(a),radius*math.cos(b)
        za,zb=spring+radius*math.sin(a),spring+radius*math.sin(b)
        if min(za,zb)<1.82-1e-9:
            parts.append(Prism('Arch infill',((xb,zb),(xa,za),(xa,1.82),(xb,1.82)),-.06,.06,'plaster'))
        for side in (-1,1):
            ya,yb=sorted((side*.048,side*.078))
            parts.append(Prism('Arched surround',((xb,zb),(xa,za),
                (inner*math.cos(a),spring+inner*math.sin(a)),
                (inner*math.cos(b),spring+inner*math.sin(b))),ya,yb,'cream'))
    for side in (-1,1):
        ya,yb=sorted((side*.048,side*.078))
        for x in (-radius,radius-.055):
            parts.append(box('Frame upright',x,x+.055,ya,yb,bottom,spring,'cream',.004))
        parts.append(box('Frame rail',-radius,radius,ya,yb,bottom,bottom+.055,'cream',.004))
    polygon=[(-inner,bottom+.055),(inner,bottom+.055),(inner,spring)]
    polygon += [(inner*math.cos(math.pi*i/24),spring+inner*math.sin(math.pi*i/24)) for i in range(1,25)]
    parts.append(Prism('Arched glass',tuple(polygon),-.009,.009,'glass'))
    parts.append(box('Stone sill',-.41,.41,-.125,.125,.595,.66,'trim',.009))
    bar(parts,0,bottom+.045,spring+inner,'cream',.032)
    return parts


def model_parts(model_id):
    name,width=MODELS[model_id]
    if model_id in (1,4,7): return window_wall(width,name)
    if model_id == 3: return arched()
    material={2:'oak',5:'charcoal',6:'sage',8:'oak',9:'cream'}[model_id]
    z0,z1=(1.45,1.80) if model_id==9 else (.65,1.82)
    parts,opening=frame(width,material,z0,z1)
    x0,x1=opening[:2]
    if model_id in (2,6): bar(parts,0,z0+.045,z1-.045,material)
    if model_id in (2,5):
        parts.append(box('Horizontal bar',x0+.045,x1-.045,-.035,.035,1.2175,1.2525,material,.003))
    if model_id in (5,9):
        for ratio in (1/3,2/3): bar(parts,x0+(x1-x0)*ratio,z0+.045,z1-.045,material)
    if model_id==6:
        for left,right in ((x0+.045,-.018),(.018,x1-.045)):
            parts.append(box('Casement crossbar',left,right,-.035,.035,1.2175,1.2525,material,.003))
        for side in (-1,1):
            for x in (-.055,.055):
                ya,yb=sorted((side*.038,side*.067))
                parts.append(box('Casement handle',x-.008,x+.008,ya,yb,1.10,1.25,'bronze',.004))
    if model_id==8:
        for x in (-.72,.72): bar(parts,x,z0+.045,z1-.045,material,.045)
        parts.append(box('Upper light rail',x0+.045,x1-.045,-.035,.035,1.50,1.54,material,.003))
        for x in (-1.02,-.36,0,.36,1.02): bar(parts,x,1.54,z1-.045,material,.028)
    return wall(width,[opening])+parts


def window_cases():
    for model_id,(model,width) in MODELS.items():
        parts=model_parts(model_id)
        for direction in DIRECTIONS:
            for height in ('full','cut'):
                yield {'geometryKey':f'window.{model}.{direction}.{height}',
                       'kind':'window','model':model_id,'width':width,
                       'direction':direction,'heightMode':height,
                       'parts':orient(cut(parts) if height=='cut' else parts,direction)}
