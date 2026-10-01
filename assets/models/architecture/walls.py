"""Connected wall hubs with explicit arm heights and shared trim geometry."""
from itertools import product
from geometry import box, wall, doorway, clip, CUT_HEIGHT
from windows import orient, DIRECTIONS

ARMS = ('east','south','west','north')


def junction(heights):
    assert len(heights)==4 and all(h in (0,1,2) for h in heights)
    assert any(heights)
    xs=(-.5,-.078,-.06,.06,.078,.5)
    ys=xs
    parts=[]
    # Grid partitioning creates one union: adjacent cells have identical faces.
    for xi,(x0,x1) in enumerate(zip(xs,xs[1:])):
        for yi,(y0,y1) in enumerate(zip(ys,ys[1:])):
            x,y=(x0+x1)/2,(y0+y1)/2
            owners=[]
            for arm,h in enumerate(heights):
                along,across=((x,y),(y,x),(-x,y),(-y,x))[arm]
                if h and along>=-.06 and abs(across)<.06: owners.append(h)
            if owners:
                height=max(CUT_HEIGHT if h==1 else 2 for h in owners)
                # A common Z partition lets mixed-height neighbors cancel their
                # shared lower face before beveling the exposed upper step.
                parts.append(box('Plaster',x0,x1,y0,y1,0,min(height,CUT_HEIGHT),'plaster'))
                if height>CUT_HEIGHT:
                    parts.append(box('Plaster',x0,x1,y0,y1,CUT_HEIGHT,height,'plaster'))
                continue
            # Baseboards occupy the exposed perimeter, never another wall's core.
            for arm,h in enumerate(heights):
                along,across=((x,y),(y,x),(-x,y),(-y,x))[arm]
                if h and along>=-.06 and .06<=abs(across)<.078:
                    parts.append(box('Baseboard',x0,x1,y0,y1,0,.14,'trim',.003))
                    break
    return parts


def owner_arm(x,y,heights):
    """A fixed nearest-arm partition, including hub tie breaks, owns every texel once."""
    scores=(x,y,-x,-y)
    return max((i for i,h in enumerate(heights) if h),key=lambda i:(scores[i],-i))


def wall_cases():
    for kind,parts in (('straight',wall(1)),('doorway',doorway())):
        for direction in DIRECTIONS:
            for height in ('full','cut'):
                yield {'geometryKey':f'{kind}.{direction}.{height}','kind':kind,
                       'width':1,'direction':direction,'heightMode':height,
                       'parts':orient(clip(parts,CUT_HEIGHT) if height=='cut' else parts,direction)}
    for heights in product((0,1,2),repeat=4):
        if not any(heights): continue
        key=''.join(str(h) for h in heights)
        yield {'geometryKey':f'junction.{key}','kind':'junction','width':1,
               'direction':'world','heightMode':'arms','armHeights':list(heights),
               'parts':junction(heights)}
