"""A compact padded chair with five real caster assemblies, facing local -Y."""
import math


def bounds(part):
    if part['shape'] == 'box':
        center, size = part['center'], part['size']
        return tuple(center[i]-size[i]/2 for i in range(3)), tuple(center[i]+size[i]/2 for i in range(3))
    a, b, radius = part['a'], part['b'], part['radius']
    length = math.dist(a, b)
    extent = [radius * math.sqrt(max(0, 1-((b[i]-a[i])/length)**2)) for i in range(3)]
    return tuple(min(a[i], b[i])-extent[i] for i in range(3)), tuple(max(a[i], b[i])+extent[i] for i in range(3))


def parts():
    rows = []

    def box(name, center, size, material, supports=(), bevel=.015):
        rows.append(dict(name=name, shape='box', center=center, size=size,
                         material=material, supports=list(supports), grounded=False, bevel=bevel))

    def cylinder(name, a, b, radius, material, supports=(), grounded=False):
        rows.append(dict(name=name, shape='cylinder', a=a, b=b, radius=radius,
                         material=material, supports=list(supports), grounded=grounded))

    cylinder('Base hub', (0, 0, .14), (0, 0, .235), .085, 'shell')
    cylinder('Gas lift', (0, 0, .18), (0, 0, .465), .037, 'metal', ('Base hub',))
    for index in range(5):
        angle = math.pi/2 + index*math.tau/5
        radial = (math.cos(angle), math.sin(angle))
        tangent = (-radial[1], radial[0])

        def point(radius, sideways, z):
            return (radius*radial[0]+sideways*tangent[0], radius*radial[1]+sideways*tangent[1], z)

        spoke, fork, axle = (f'{name} {index}' for name in ('Base spoke', 'Caster fork', 'Caster axle'))
        cylinder(spoke, point(.04, 0, .195), point(.30, 0, .13), .027, 'shell', ('Base hub',))
        cylinder(fork, point(.30, 0, .055), point(.30, 0, .145), .027, 'metal', (spoke,))
        cylinder(axle, point(.30, -.045, .055), point(.30, .045, .055), .019, 'metal', (fork,))
        for sign in (-1, 1):
            cylinder(f'Caster wheel {index} {sign}', point(.30, sign*.021, .055),
                     point(.30, sign*.047, .055), .055, 'rubber', (axle,), grounded=True)
    box('Seat pan', (0, -.015, .435), (.56, .54, .09), 'shell', ('Gas lift',), .024)
    box('Seat cushion', (0, -.035, .510), (.62, .61, .115), 'fabric', ('Seat pan',), .048)
    cylinder('Back spine', (0, .22, .43), (0, .26, .86), .035, 'shell', ('Seat pan',))
    box('Back shell', (0, .245, .845), (.61, .09, .64), 'shell', ('Back spine',), .039)
    box('Back cushion', (0, .18, .88), (.55, .11, .55), 'fabric', ('Back shell',), .047)
    cylinder('Seat adjustment lever', (.20, -.05, .43), (.32, -.05, .43), .018,
             'metal', ('Seat pan',))
    box('Seat adjustment grip', (.32, -.05, .43), (.065, .065, .045), 'rubber',
        ('Seat adjustment lever',), .016)
    return rows
