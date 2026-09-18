"""Closed ceramic shell for the pedestal bathroom sink."""
from counter_geometry import rounded_loop


def ceramic_basin():
    outer = rounded_loop(.355,.30,.11,.82)
    inside = rounded_loop(.275,.20,.085,.82,-.055)
    floor = rounded_loop(.18,.115,.07,.655,-.055)
    underside = rounded_loop(.215,.175,.09,.61)
    n = len(outer)
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),
                  (i,3*n+i,3*n+j,j)]
    faces += [tuple(range(2*n,3*n)),tuple(reversed(range(3*n,4*n)))]
    return outer+inside+floor+underside,faces
