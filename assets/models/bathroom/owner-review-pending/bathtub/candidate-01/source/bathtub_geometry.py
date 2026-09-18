"""Continuous enamel shell with a sloping interior and a solid tap deck."""
from counter_geometry import rounded_loop


def ceramic_tub():
    outer = rounded_loop(.41,.92,.16,.57,-.5)
    inside = rounded_loop(.335,.77,.15,.57,-.56)
    floor = rounded_loop(.23,.64,.14,.15,-.56)
    underside = rounded_loop(.33,.83,.14,.045,-.5)
    n = len(outer)
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),
                  (i,3*n+i,3*n+j,j)]
    faces += [tuple(range(2*n,3*n)),tuple(reversed(range(3*n,4*n)))]
    return outer+inside+floor+underside,faces
