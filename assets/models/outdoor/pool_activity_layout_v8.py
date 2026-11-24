"""The square basin wraps around a dry access bay and its sloping exterior ladder."""
import pool_activity_layout_v4 as basin
import pool_activity_layout_v7 as platform

INSET = .55
OUTER_SLOPE = .60
LADDER_RAIL_X = platform.LADDER_RAIL_X
TOE_RECESS_X = platform.TOE_RECESS_X
CREST_LANDING_DEPTH = platform.CREST_LANDING_DEPTH
CREST_LANDING_Y = platform.CREST_LANDING_Y-INSET
LADDER_INSIDE_TREADS = tuple((y-INSET,z) for y,z in platform.LADDER_INSIDE_TREADS)
LADDER_OUTSIDE_TREADS = tuple((y-INSET+OUTER_SLOPE*(1-z),z) for y,z in basin.LADDER_OUTSIDE_TREADS)
LADDER_STRINGERS = tuple(tuple((y-INSET,z) for y,z in flight) for flight in platform.LADDER_STRINGERS)
LADDER_PATH = tuple((y-INSET,z) for y,z in platform.LADDER_PATH[:5])+(
    (.98-INSET,1.),(.98-INSET+OUTER_SLOPE*(1-.08),.08))

# Each outline is a square with a rectangular opening on its north side.
DRY = (.94, -.87, -.13, .39)
WET = (.86, -.90, -.10, .31)
COPING_OUT = (.96, -.86, -.14, .41)
COPING_IN = (.85, -.91, -.09, .30)
WATER = (.865, -.895, -.105, .315)


def ladder_rail_points(x):
    return [(x,y,z) for y,z in LADDER_PATH]


def contains(outline,x,y):
    extent,left,right,back=outline
    return abs(x)<extent and abs(y)<extent and not (left<x<right and y>back)


def grid_shell(outer,inner,z0,z1):
    """Emit only boundary faces of the filled square/notch cell difference."""
    xs=sorted({v for h,l,r,_ in (outer,inner) for v in (-h,l,r,h)})
    ys=sorted({v for h,_,_,b in (outer,inner) for v in (-h,b,h)})
    filled={(i,j) for i in range(len(xs)-1) for j in range(len(ys)-1)
            if contains(outer,(xs[i]+xs[i+1])/2,(ys[j]+ys[j+1])/2)
            and not contains(inner,(xs[i]+xs[i+1])/2,(ys[j]+ys[j+1])/2)}
    vertices=[]; faces=[]; materials=[]; ids={}
    def face(points,material=0):
        result=[]
        for key in points:
            if key not in ids:ids[key]=len(vertices);vertices.append(key)
            result.append(ids[key])
        faces.append(tuple(result));materials.append(material)
    for i,j in sorted(filled):
        x0,x1=xs[i:i+2];y0,y1=ys[j:j+2]
        loop=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
        face([(x,y,z1) for x,y in loop]);face([(x,y,z0) for x,y in reversed(loop)])
        for k,(di,dj) in enumerate(((0,-1),(1,0),(0,1),(-1,0))):
            if (i+di,j+dj) in filled:continue
            p,q=loop[k],loop[(k+1)%4]
            inside=contains(inner,(p[0]+q[0])/2+di*1e-6,(p[1]+q[1])/2+dj*1e-6)
            face([(*p,z0),(*q,z0),(*q,z1),(*p,z1)],int(inside))
    return vertices,faces,materials


def recessed_wall_geometry():
    return grid_shell(DRY,WET,0,basin.COPING_BOTTOM)


def surface(outline,z,subdivisions=1):
    extent,left,right,back=outline
    regular=[-extent+2*extent*i/subdivisions for i in range(subdivisions+1)]
    xs=sorted({*regular,*(v for v in [left,right] if -extent<v<extent)})
    ys=sorted({*regular,back})
    points=[];indices={};faces=[];centres=[]
    for j in range(len(ys)-1):
        for i in range(len(xs)-1):
            x0,x1=xs[i:i+2];y0,y1=ys[j:j+2];centre=((x0+x1)/2,(y0+y1)/2)
            if not contains(outline,*centre):continue
            poly=[]
            for p in [(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)]:
                if p not in indices:indices[p]=len(points);points.append(p)
                poly.append(indices[p])
            faces.append(tuple(poly));centres.append(centre)
    return points,faces,centres
