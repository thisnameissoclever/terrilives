"""A square teal footrest with four feet, one cushion and a continuous welt."""
import math


def parts():
    rows = []
    for x in (-.275, .275):
        for y in (-.275, .275):
            rows.append(dict(name=f'Foot {x} {y}', center=(x, y, .075),
                             size=(.085, .085, .15), bevel=.01, material='wood',
                             grounded=True, supports=[]))
    rows.append(dict(name='Upholstered frame', center=(0, 0, .18),
                     size=(.68, .68, .14), bevel=.03, material='fabric',
                     grounded=False, supports=[part['name'] for part in rows]))
    rows.append(dict(name='Cushion', center=(0, 0, .30), size=(.74, .74, .17),
                     bevel=.045, material='cushion', grounded=False,
                     supports=['Upholstered frame']))
    return rows


def welt_path():
    radius, extent = .043, .326
    centers = [(extent, extent), (-extent, extent),
               (-extent, -extent), (extent, -extent)]
    points = []
    for corner, (x, y) in enumerate(centers):
        angle = corner*math.pi/2
        for step in range(17):
            theta = angle+step/16*math.pi/2
            points.append((x+radius*math.cos(theta), y+radius*math.sin(theta), .29))
        next_x, next_y = centers[(corner+1)%4]
        theta = angle+math.pi/2
        end = (next_x+radius*math.cos(theta), next_y+radius*math.sin(theta), .29)
        start = points[-1]
        for step in range(1, 17):
            points.append(tuple(a+(b-a)*step/17 for a, b in zip(start, end)))
    return points
