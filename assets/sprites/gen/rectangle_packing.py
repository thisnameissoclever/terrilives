"""Deterministic rectangle packing without rotating registered artwork."""


def pack_rectangles(sizes, width, ceiling, padding):
    """Split maximal free rectangles and choose the tightest short-side fit."""
    padded = [(w+padding, h+padding) for w, h in sizes]
    if any(w > width or h > ceiling for w, h in padded):
        raise ValueError('sprite exceeds texture dimension limit')
    if sum(w*h for w, h in padded) > width*ceiling:
        raise ValueError('sprite area exceeds texture dimension limit')
    free = [(0, 0, width, ceiling)]
    placed = {}
    for index in sorted(range(len(padded)), key=lambda i: (-padded[i][0]*padded[i][1], -max(padded[i]), i)):
        w, h = padded[index]
        candidates = [(min(fw-w, fh-h), max(fw-w, fh-h), y, x)
                      for x, y, fw, fh in free if fw >= w and fh >= h]
        if not candidates:
            raise ValueError('rectangles exceed texture dimension limit')
        _, _, y, x = min(candidates)
        placed[index] = (x, y)
        remaining = []
        for fx, fy, fw, fh in free:
            right, bottom = fx+fw, fy+fh
            if x >= right or x+w <= fx or y >= bottom or y+h <= fy:
                remaining.append((fx, fy, fw, fh))
                continue
            if x > fx:
                remaining.append((fx, fy, x-fx, fh))
            if x+w < right:
                remaining.append((x+w, fy, right-x-w, fh))
            if y > fy:
                remaining.append((fx, fy, fw, y-fy))
            if y+h < bottom:
                remaining.append((fx, y+h, fw, bottom-y-h))
        remaining = sorted(set(remaining))
        free = [a for a in remaining if not any(
            a != b and a[0] >= b[0] and a[1] >= b[1] and
            a[0]+a[2] <= b[0]+b[2] and a[1]+a[3] <= b[1]+b[3]
            for b in remaining)]
    height = max((placed[i][1]+h for i, (_, h) in enumerate(padded)), default=1)
    return placed, width, height
