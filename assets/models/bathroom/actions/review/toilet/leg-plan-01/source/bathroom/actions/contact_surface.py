"""Partition actual surface projections and certify their affine gap extrema."""
import math

AREA_TOLERANCE = 1e-12


def _finite(values):
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Contact surface evidence must contain finite numbers')


def signed_area(polygon):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(polygon, polygon[1:]+polygon[:1]))/2


def clip_polygon(subject, clip):
    result = list(subject)
    for a, b in zip(clip, clip[1:]+clip[:1]):
        def distance(p):
            return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        previous = result[-1] if result else None
        following = []
        for point in result:
            dp, dq = distance(previous), distance(point)
            if (dp >= 0) != (dq >= 0):
                ratio = dp/(dp-dq)
                following.append(tuple(previous[i]+ratio*(point[i]-previous[i]) for i in range(2)))
            if dq >= 0:
                following.append(point)
            previous = point
        result = following
        if not result:
            break
    return result


def _pieces(triangles, rectangle, area):
    result = []
    for index, triangle in enumerate(triangles):
        if len(triangle) != 3 or any(len(p) != 3 for p in triangle):
            raise ValueError('Contact surface requires complete triangles')
        _finite(v for point in triangle for v in point)
        xy = [tuple(p[:2]) for p in triangle]
        orientation = signed_area(xy)
        if orientation == 0:
            continue
        if orientation < 0:
            xy.reverse()
        polygon = clip_polygon(xy, rectangle)
        if len(polygon) < 3 or signed_area(polygon) <= AREA_TOLERANCE:
            continue
        a, b, c = triangle
        u, v = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
        normal = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        plane = (-normal[0]/normal[2], -normal[1]/normal[2],
                 a[2]+normal[0]/normal[2]*a[0]+normal[1]/normal[2]*a[1])
        result.append(dict(triangle=index, polygon=polygon, plane=plane))
    for i, first in enumerate(result):
        for second in result[i+1:]:
            overlap = clip_polygon(first['polygon'], second['polygon'])
            if len(overlap) >= 3 and signed_area(overlap) > AREA_TOLERANCE:
                raise ValueError('Projected surface pieces overlap; height ownership is ambiguous')
    if abs(sum(signed_area(piece['polygon']) for piece in result)-area) > AREA_TOLERANCE:
        raise ValueError('Actual surface coverage does not fill the complete cell')
    return result


def certify_cell(bounds, body_triangles, seat_triangles, min_gap=0, max_gap=.01):
    if len(bounds) != 4:
        raise ValueError('Contact cell needs four bounds')
    _finite((*bounds, min_gap, max_gap))
    left, bottom, right, top = bounds
    if not left < right or not bottom < top or not 0 <= min_gap <= max_gap:
        raise ValueError('Contact cell bounds or gap limits are not ordered')
    area = (right-left)*(top-bottom)
    if area <= AREA_TOLERANCE:
        raise ValueError('Contact cell is below the declared arithmetic area resolution')
    rectangle = [(left, bottom), (right, bottom), (right, top), (left, top)]
    bodies, seats = _pieces(body_triangles, rectangle, area), _pieces(seat_triangles, rectangle, area)
    witnesses, total, gaps = [], 0., []
    for body in bodies:
        for seat in seats:
            polygon = clip_polygon(body['polygon'], seat['polygon'])
            if len(polygon) < 3 or signed_area(polygon) <= AREA_TOLERANCE:
                continue
            values = [sum((a-b)*c for a, b, c in zip(body['plane'], seat['plane'], (x, y, 1))) for x, y in polygon]
            _finite(values)
            if min(values) < min_gap or max(values) > max_gap:
                raise ValueError('Continuous body-to-seat gap leaves the declared contact interval')
            total += signed_area(polygon)
            gaps.extend(values)
            witnesses.append(dict(body_triangle=body['triangle'], seat_triangle=seat['triangle'],
                                  polygon_xy=polygon, gaps=values))
    if abs(total-area) > AREA_TOLERANCE or not gaps:
        raise ValueError('Actual paired surface coverage is incomplete')
    return dict(area=min(total, area), min_gap=min(gaps), max_gap=max(gaps),
                arithmetic_area_tolerance=AREA_TOLERANCE, partitions=witnesses)


def connected_regions(cells, step):
    _finite((step,))
    if step <= 0:
        raise ValueError('Contact cell step must be positive')
    for key, area in cells.items():
        if len(key) != 2 or any(type(i) is not int for i in key):
            raise ValueError('Contact cells need integer grid indices')
        _finite((area,))
        if not 0 < area <= step*step+AREA_TOLERANCE:
            raise ValueError('Certified contact area exceeds its physical cell')
    remaining, result = set(cells), []
    while remaining:
        first = min(remaining)
        component, frontier = {first}, {first}
        while frontier:
            adjacent = {(x+dx, y+dy) for x, y in frontier for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))}
            following = (adjacent & remaining)-component
            component |= following
            frontier = following
        remaining -= component
        result.append(dict(cells=sorted(component), area=sum(cells[key] for key in component),
            width=(max(x for x, _ in component)-min(x for x, _ in component)+1)*step,
            depth=(max(y for _, y in component)-min(y for _, y in component)+1)*step))
    return result
