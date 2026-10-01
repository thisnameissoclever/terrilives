"""Reconstruct one scene from registered, premultiplied owner contributions."""
from PIL import Image


def reconstruct(layers, outline):
    if not layers or any(layer.size != outline.size for layer in layers):
        raise ValueError('Expected registered owner layers and one matching outline')
    pixels = []
    for values in zip(*(layer.getdata() for layer in layers), outline.getdata()):
        owners, ink = values[:-1], values[-1]
        coverage = sum(owner[3] for owner in owners)
        if coverage > 257:
            raise ValueError('Owner coverage exceeds the joint scene')
        remaining = 1 - ink[3]/255
        alpha = ink[3] + coverage*remaining
        if alpha == 0:
            pixels.append((0, 0, 0, 0))
        else:
            rgb = tuple(min(255, round((ink[i]+sum(owner[i] for owner in owners)*remaining)*255/alpha))
                        for i in range(3))
            pixels.append((*rgb, min(255, round(alpha))))
    result = Image.new('RGBA', outline.size)
    result.putdata(pixels)
    return result


def comparison(reference, actual, owners):
    errors, edge_errors, body_errors = [], [], []
    for expected, result, *parts in zip(reference.getdata(), actual.getdata(),
                                      *(owner.getdata() for owner in owners)):
        if not expected[3] and not result[3]:
            continue
        error = max(abs(a-b) for a, b in zip(expected, result))
        errors.append(error)
        if any(0 < part[3] < 255 for part in parts):
            edge_errors.append(error)
        if any(part[3] for part in parts[1:]):
            body_errors.append(error)
    def metrics(values):
        ordered = sorted(values)
        return {'max_error': max(ordered, default=0),
                'p95_error': ordered[int(len(ordered)*.95)] if ordered else 0,
                'active_pixels': len(ordered), 'pixels_above_8': sum(x > 8 for x in ordered)}
    result = {'scene': metrics(errors), 'partial_coverage': metrics(edge_errors),
              'visible_sleepers': metrics(body_errors)}
    if not errors or result['scene']['p95_error'] > 12 or result['scene']['max_error'] > 64:
        raise ValueError(f'Joint reconstruction differs from beauty: {result}')
    return result
