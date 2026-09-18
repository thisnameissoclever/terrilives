"""Mesh data for matching solid and sink-cut worktops."""
import math


def rounded_loop(half_x, half_y, radius, z, shift_y=0):
    points = []
    for quadrant,(sx,sy) in enumerate(((1,1),(-1,1),(-1,-1),(1,-1))):
        for step in range(9):
            angle = math.radians(quadrant*90+step*90/8)
            points.append((sx*(half_x-radius)+radius*math.cos(angle),
                           sy*(half_y-radius)+radius*math.sin(angle)+shift_y,z))
    return points


def worktop_mesh(sink=False):
    top = rounded_loop(.5,.5,.018,.86)
    bottom = rounded_loop(.5,.5,.018,.79)
    n = len(top)
    vertices = top+bottom
    faces = [(n+i,n+(i+1)%n,(i+1)%n,i) for i in range(n)]
    if not sink:
        faces += [tuple(range(n)),tuple(reversed(range(n,2*n)))]
        return vertices,faces
    vertices += rounded_loop(.32,.27,.035,.86,-.04)
    vertices += rounded_loop(.32,.27,.035,.79,-.04)
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,2*n+j,2*n+i),
                  (2*n+i,2*n+j,3*n+j,3*n+i),
                  (n+i,3*n+i,3*n+j,n+j)]
    return vertices,faces


def basin_mesh():
    lip = rounded_loop(.345,.285,.045,.867,-.04)
    inside = rounded_loop(.295,.235,.05,.867,-.04)
    floor = rounded_loop(.235,.175,.06,.63,-.04)
    n = len(lip)
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i)]
    faces.append(tuple(range(2*n,3*n)))
    return lip+inside+floor,faces
