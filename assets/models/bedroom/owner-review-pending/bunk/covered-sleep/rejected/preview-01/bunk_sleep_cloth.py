"""Generate one narrow duvet with continuous side and foot drapes."""
import math


def geometry(body_height):
    """Return vertices, quads and material indices from world-space top rays."""
    nx, ny = 81, 71
    xs = [-.36 + .72 * index / (nx - 1) for index in range(nx)]
    ys = [-.923 + 1.148 * index / (ny - 1) for index in range(ny)]
    xs[0], xs[-1], ys[0], ys[-1] = -.36, .36, -.923, .225
    heights = [[.478 for _ in xs] for _ in ys]
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            hit = body_height(x, y)
            if hit is not None:
                if not math.isfinite(hit):
                    raise ValueError('Body ray returned a nonfinite height')
                heights[iy][ix] = max(.478, hit + .045)
    draped = [row.copy() for row in heights]
    dx, dy, radius = xs[1] - xs[0], ys[1] - ys[0], .24
    for iy, row in enumerate(heights):
        for ix, height in enumerate(row):
            if height <= .478:
                continue
            for oy in range(-int(radius / dy), int(radius / dy) + 1):
                target_y = iy + oy
                if not 0 <= target_y < ny:
                    continue
                for ox in range(-int(radius / dx), int(radius / dx) + 1):
                    target_x = ix + ox
                    distance = (ox * dx) ** 2 + (oy * dy) ** 2
                    if 0 <= target_x < nx and distance <= radius ** 2:
                        draped[target_y][target_x] = max(
                            draped[target_y][target_x], height - 6 * distance)
    vertices = [(x, y, draped[iy][ix])
                for iy, y in enumerate(ys) for ix, x in enumerate(xs)]
    faces, materials = [], []
    for iy in range(ny - 1):
        for ix in range(nx - 1):
            a = iy * nx + ix
            faces.append((a, a + 1, a + nx + 1, a + nx))
            materials.append(int(ys[iy] >= .105))
    edge = [iy * nx for iy in range(ny - 1, -1, -1)]
    edge += list(range(1, nx))
    edge += [iy * nx + nx - 1 for iy in range(1, ny)]
    previous = edge
    for theta in (math.pi / 8, math.pi / 4, 3 * math.pi / 8, math.pi / 2):
        current = []
        for index in edge:
            x, y, z = vertices[index]
            outward_x = -.012 if x == xs[0] else .012 if x == xs[-1] else 0
            outward_y = -.012 if y == ys[0] else 0
            current.append(len(vertices))
            vertices.append((x + outward_x * math.sin(theta),
                             y + outward_y * math.sin(theta),
                             .43 + (z - .43) * math.cos(theta)))
        for index in range(len(edge) - 1):
            faces.append((previous[index], current[index],
                          current[index + 1], previous[index + 1]))
            materials.append(int(vertices[edge[index]][1] >= .105))
        previous = current
    return vertices, faces, materials
