"""Finite support-height intervals and complete minimal grid-rectangle shapes."""
import math
from numbers import Real


def finite_values(values):
    values = tuple(values)
    if not values or any(isinstance(value, bool) or not isinstance(value, Real)
                         or not math.isfinite(value) for value in values):
        raise ValueError('Support values must be finite numbers and nonempty')
    return values


def height_interval(global_gaps, patch_gaps, min_contact=0, max_contact=.003, max_patch=.01):
    """Intersect nonpenetration, nearest-contact and complete-patch bounds."""
    global_gaps, patch_gaps = finite_values(global_gaps), finite_values(patch_gaps)
    finite_values((min_contact, max_contact, max_patch))
    if not 0 <= min_contact <= max_contact <= max_patch:
        raise ValueError('Support gap limits are not ordered')
    lower = max(min_contact-min(global_gaps), -min(patch_gaps))
    upper = min(max_contact-min(global_gaps), max_patch-max(patch_gaps))
    return (lower, upper) if lower <= upper else None


def minimal_grid_rectangles(step, min_width, min_depth, min_area):
    """Return every nondominated integer span meeting the same finite criteria."""
    if min(finite_values((step, min_width, min_depth, min_area))) <= 0:
        raise ValueError('Support search parameters must be positive')
    first_x, first_y = math.ceil(min_width/step), math.ceil(min_depth/step)
    area_cells = math.ceil(min_area/(step*step))
    last_x = max(first_x, math.ceil(area_cells/first_y))
    result, previous_y = [], math.inf
    for width in range(first_x, last_x+1):
        depth = max(first_y, math.ceil(area_cells/width))
        if depth < previous_y:
            result.append((width, depth))
            previous_y = depth
    return result
