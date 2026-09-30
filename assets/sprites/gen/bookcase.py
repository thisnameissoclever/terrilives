"""Tile-edge geometry for the live bookcase, in four quarter turns."""
from style import PALETTE as C, mul
from iso import box, contact_shadow

def draw(d, facing="se"):
    # The back is on x=-0.5 before rotation, exactly at the tile edge.
    w = C["wood"]
    across = 0.86
    x0, y0, x1, y1 = -.5, -across / 2, -.22, across / 2
    contact_shadow(d, x0, y0, x1, y1, facing)
    t = .06
    parts = []
    def part(a, b, c, e, low, high, colour):
        parts.append((a, b, c, e, low, high, colour))
    part(x0, y0, x0 + t, y1, 0, 1.48, mul(w, .78))
    part(x0, y0, x1, y0 + t, 0, 1.48, mul(w, .88))
    part(x0, y1 - t, x1, y1, 0, 1.48, mul(w, .92))
    part(x0, y0, x1, y1, 0, .10, mul(w, .84))
    spines = (C["accent_clay"], C["accent_sage"], C["accent_brass"],
              C["accent_slate"], C["wood_dark"], C["fabric"])
    n = 6
    for i in range(4):
        z = .10 + i * .34
        part(x0 + t, y0 + t, x1 - .02, y1 - t, z - .06, z, w)
        span = y1 - y0 - 2 * t - .04
        for j in range(n):
            by0 = y0 + t + .02 + j * span / n
            part(x0 + t + .02, by0, x1 - .04, by0 + span / n - .016,
                 z, z + .20 + ((i * 7 + j * 3) % 5) * .020,
                 spines[(i * 5 + j) % len(spines)])
    part(x0, y0 - .02, x1 + .02, y1 + .02, 1.46, 1.54, w)
    # Tall near panels must cover every shelf, regardless of its height.
    back, side_a, side_b = parts[:3]
    near = ([back] if facing in ("nw", "ne") else [])
    near += [side_b if facing in ("se", "ne") else side_a]
    far = [panel for panel in (back, side_a, side_b) if panel not in near]
    for piece in (*far, *parts[3:-1], *near, parts[-1]):
        box(d, *piece, facing=facing)
