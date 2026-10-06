"""Evaluate a normalized linear blend of affine bone transforms independently."""
import math


def _finite(values):
    if any(isinstance(value, bool) or not isinstance(value, (int, float))
           or not math.isfinite(value) for value in values):
        raise ValueError('Skinning evidence must contain finite numbers')


def weighted_point(point, influences):
    if len(point) != 3 or not influences:
        raise ValueError('Skinning requires one complete point and its influences')
    _finite(point)
    total, result = 0., [0., 0., 0.]
    for weight, matrix in influences:
        _finite((weight,))
        if weight < 0 or len(matrix) != 4 or any(len(row) != 4 for row in matrix):
            raise ValueError('Skinning weights or matrix dimensions are invalid')
        _finite(value for row in matrix for value in row)
        if tuple(matrix[3]) != (0, 0, 0, 1):
            raise ValueError('Bone transform must be affine, not projective')
        for axis in range(3):
            result[axis] += weight * (sum(matrix[axis][i]*point[i] for i in range(3)) + matrix[axis][3])
        total += weight
    if abs(total-1) > 1e-6:
        raise ValueError('Diagnostic requires explicitly normalized bone weights')
    return tuple(result)
