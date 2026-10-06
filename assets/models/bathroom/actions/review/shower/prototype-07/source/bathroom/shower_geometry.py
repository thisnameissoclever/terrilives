"""A recessed shower tray with a closed underside."""
from counter_geometry import rounded_loop


def tray_shell():
    loops = [rounded_loop(.46, .46, .055, .135),
             rounded_loop(.39, .39, .035, .135),
             rounded_loop(.375, .375, .03, .055),
             rounded_loop(.46, .46, .055, 0)]
    n = len(loops[0])
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n+j, n+i), (n+i, n+j, 2*n+j, 2*n+i),
                  (i, 3*n+i, 3*n+j, j)]
    faces += [tuple(range(2*n, 3*n)), tuple(reversed(range(3*n, 4*n)))]
    return [point for loop in loops for point in loop], faces
