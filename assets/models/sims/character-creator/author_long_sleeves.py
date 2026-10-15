"""Join the source garment and forearm profiles into one deforming sleeve."""


def ring_sections(vertices, faces):
    """Read a capped quad tube without relying on source vertex numbering."""
    caps = [face for face in faces if len(face) > 4]
    if len(caps) != 2 or len(caps[0]) != len(caps[1]):
        raise ValueError('Sleeve source must have two matching polygon caps')
    first = min(caps, key=lambda face: sum(vertices[index][2] for index in face))
    last = set(caps[1] if first is caps[0] else caps[0])
    neighbours = [set() for _ in vertices]
    for face in faces:
        for a, b in zip(face, (*face[1:], face[0])):
            neighbours[a].add(b)
            neighbours[b].add(a)
    current, previous, rings, visited = list(first), set(), [], set()
    while True:
        if visited.intersection(current):
            raise ValueError('Sleeve source rings must not branch or repeat')
        visited.update(current)
        rings.append([vertices[index] for index in current])
        if set(current) == last:
            break
        ring_set = set(current)
        following = [neighbours[index] - ring_set - previous for index in current]
        if any(len(candidates) != 1 for candidates in following):
            raise ValueError('Sleeve source must be a regular quad tube')
        previous, current = ring_set, [next(iter(candidates)) for candidates in following]
    if len(visited) != len(vertices) or len(rings) < 3:
        raise ValueError('Sleeve source has disconnected or missing ring geometry')
    # Both sources use horizontal cross sections. Normalize their angular order.
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(rings[0], rings[0][1:]+rings[0][:1]))
    return [list(reversed(ring)) for ring in rings] if area < 0 else rings


def continuous_sleeve_geometry(upper_vertices, upper_faces, lower_vertices, lower_faces):
    upper = ring_sections(upper_vertices, upper_faces)
    lower = ring_sections(lower_vertices, lower_faces)
    sectors = len(upper[0])
    if any(len(ring) != sectors for ring in lower):
        raise ValueError('Sleeve profiles need matching cross sections')
    # Remove the skin's elbow-end ring. Its cap used to overlap the shirt cap.
    lower = lower[:-1]
    if max(point[2] for point in lower[-1]) >= min(point[2] for point in upper[0]):
        raise ValueError('Sleeve bridge must progress from wrist toward shoulder')
    # Find the untwisted correspondence, independent of each cap's first vertex.
    offset = min(range(sectors), key=lambda shift: sum(
        sum((a[axis]-upper[0][(index+shift)%sectors][axis])**2 for axis in range(3))
        for index, a in enumerate(lower[-1])))
    upper = [ring[offset:]+ring[:offset] for ring in upper]
    rings = lower + upper
    vertices = [point for ring in rings for point in ring]
    faces = [(j*sectors+i, j*sectors+(i+1)%sectors,
              (j+1)*sectors+(i+1)%sectors, (j+1)*sectors+i)
             for j in range(len(rings)-1) for i in range(sectors)]
    faces.extend([tuple(reversed(range(sectors))),
                  tuple((len(rings)-1)*sectors+i for i in range(sectors))])
    return vertices, faces


def sleeve_weights(height):
    def blend(low, high):
        value = max(0., min(1., (height-low)/(high-low)))
        return value*value*(3.-2.*value)
    torso = blend(1.26, 1.37)*.88
    upper = blend(.96, 1.085)
    hand = 1.-blend(.795, .835)
    return {'spine': torso, 'upper_arm': (1.-torso)*upper,
            'forearm': (1.-torso)*(1.-upper)*(1.-hand),
            'hand': (1.-torso)*(1.-upper)*hand}
