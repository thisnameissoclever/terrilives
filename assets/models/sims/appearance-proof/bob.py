"""A closed sculpted bob, authored in the accepted character's rest space."""
import math


def cap_geometry():
    sectors, bands = 48, 22
    vertices, faces = [], []
    # Two continuous surfaces share their lower rim; no disconnected hair balls.
    for inner in (False, True):
        for j in range(bands + 1):
            for i in range(sectors):
                phi = i * math.tau / sectors
                front = max(0., math.cos(phi))
                limit = 2.43 - 1.24 * front ** 1.6
                angle = (phi + math.pi) % math.tau - math.pi
                limit -= .30 * math.exp(-((angle + 1.05) / .27) ** 2)
                theta = .025 + (limit - .025) * j / bands
                wave = .004 * math.cos(phi * 9 + theta * 1.8) * math.sin(theta)
                thickness = .012 if inner else 0
                rx = .252 + .016 * math.sin(theta) ** 3 + wave - thickness
                ry = .225 + wave - thickness
                x = rx * math.sin(theta) * math.sin(phi)
                y = -ry * math.sin(theta) * math.cos(phi) + .008
                z = 1.754 + (.315 - thickness) * math.cos(theta)
                # A swept part, rather than a symmetric helmet-like fringe.
                z += .025 * math.sin(phi + .7) * math.sin(theta) ** 2 * front
                vertices.append((x, y, z))
        offset = int(inner) * sectors * (bands + 1)
        for j in range(bands):
            for i in range(sectors):
                a = offset + j * sectors + i
                b = offset + j * sectors + (i + 1) % sectors
                face = (a, b, b + sectors, a + sectors)
                faces.append(tuple(reversed(face)) if inner else face)
    size = sectors * (bands + 1)
    for row in (0, bands):
        for i in range(sectors):
            a = row * sectors + i; b = row * sectors + (i + 1) % sectors
            faces.append((a, a + size, b + size, b) if row == bands else (b, b + size, a + size, a))
    return vertices, [tuple(reversed(face)) for face in faces]


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def unit(a):
    size = math.sqrt(sum(v*v for v in a))
    if size < 1e-9:
        raise ValueError('Hair lock has a degenerate frame')
    return tuple(v/size for v in a)


def lock_geometry(control, width, thickness):
    """A closed flattened lock follows a cubic curve from the part to its tip."""
    vertices, faces = [], []
    rings, sides = 25, 12
    centres = []
    for j in range(rings):
        t = j/(rings-1); u = 1-t
        point = tuple(u**3*control[0][k]+3*u*u*t*control[1][k]+3*u*t*t*control[2][k]+t**3*control[3][k] for k in range(3))
        centre = (0, .008, 1.754)
        delta = tuple(point[k]-centre[k] for k in range(3))
        radius = math.sqrt(sum((delta[k]/(.268,.238,.316)[k])**2 for k in range(3)))
        centres.append(tuple(centre[k]+delta[k]/radius for k in range(3)))
    for j, point in enumerate(centres):
        t = j/(rings-1)
        before, after = centres[max(0,j-1)], centres[min(rings-1,j+1)]
        tangent = unit(tuple(after[k]-before[k] for k in range(3)))
        outward = (point[0], point[1], point[2]-1.754)
        side = unit(cross(tangent, outward))
        normal = unit(cross(side, tangent))
        taper = .08 + .92 * math.sin(math.pi*(.12+.86*t))**.65
        for i in range(sides):
            phi = i*math.tau/sides
            vertices.append(tuple(point[k]+side[k]*math.cos(phi)*width*taper+normal[k]*math.sin(phi)*thickness*taper for k in range(3)))
    for j in range(rings-1):
        for i in range(sides):
            a=j*sides+i; b=j*sides+(i+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((rings-1)*sides+i for i in range(sides)))
    return vertices, [tuple(reversed(face)) for face in faces]


def geometry():
    vertices, faces = cap_geometry()
    # Broad overlapping locks expose a side part and leave the forehead readable.
    locks = [
        (((-.10,-.015,2.045),(-.02,-.21,2.13),(.19,-.28,1.985),(.25,-.08,1.77)),.062,.026),
        (((-.12,.035,2.057),(.10,-.085,2.18),(.26,-.13,2.02),(.263,.055,1.58)),.068,.021),
        (((-.11,.09,2.04),(.12,.09,2.14),(.30,.08,1.91),(.22,.15,1.49)),.063,.024),
        (((-.125,-.018,2.04),(-.25,-.08,2.02),(-.28,-.18,1.92),(-.20,-.16,1.86)),.043,.025),
        (((-.135,.05,2.03),(-.27,.00,2.04),(-.285,.09,1.75),(-.21,.16,1.49)),.052,.023),
        (((-.075,.13,2.04),(.025,.23,2.05),(.05,.27,1.76),(.055,.215,1.50)),.072,.023),
        (((-.145,.11,2.005),(-.20,.20,2.05),(-.19,.27,1.73),(-.105,.20,1.50)),.055,.023),
    ]
    for control, width, thickness in locks:
        points, polygons = lock_geometry(control, width, thickness)
        offset=len(vertices); vertices.extend(points)
        faces.extend(tuple(offset+i for i in face) for face in polygons)
    return vertices, faces


def create(material):
    import bpy
    vertices, faces = geometry()
    mesh = bpy.data.meshes.new('Proof bob closed mesh')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new('PROOF_BOB', mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.vertex_groups.new(name='head').add(list(range(len(vertices))), 1., 'REPLACE')
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj
