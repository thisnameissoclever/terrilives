"""Find complete mirrored finite patches with a compatible vertical interval."""
from toilet_pose_geometry import validate_patches
from toilet_support_planner import finite_values, height_interval, minimal_grid_rectangles


def support_candidates(points, step=.003):
    if not points:
        return []
    indexed = {}
    for point in points:
        finite_values(point[field] for field in ('x', 'y', 'seat_z', 'hip_z', 'gap'))
        if abs(point['hip_z']-point['seat_z']-point['gap']) > 1e-6:
            raise ValueError('Support witness gap disagrees with actual surface heights')
        key = (round(point['x'], 6), round(point['y'], 6))
        if key in indexed:
            raise ValueError('Duplicate ring support witness')
        indexed[key] = point
    shapes = minimal_grid_rectangles(step, .015, .035, .0007)
    global_gaps = [point['gap'] for point in points]
    results = []
    for x, y in sorted(indexed):
        if x < .08:
            continue
        for width, depth in shapes:
            patches = [[indexed.get((round(side*(x+ix*step), 6), round(y+iy*step, 6)))
                        for ix in range(width+1) for iy in range(depth+1)] for side in (-1, 1)]
            if any(point is None for patch in patches for point in patch):
                continue
            try:
                measured = validate_patches([[(p['x'], p['y'], p['seat_z']) for p in patch] for patch in patches])
            except ValueError:
                continue
            interval = height_interval(global_gaps, [p['gap'] for patch in patches for p in patch])
            if interval is not None:
                results.append(dict(height_interval=list(interval), patches=patches,
                                    finite_patches=measured, grid_span=[width, depth]))
    return results
