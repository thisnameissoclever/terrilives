"""Lateral ladder dimensions for the widened passage, in pool-local metres."""
from pool_activity_layout_v4 import LADDER_RAIL_X, TOE_RECESS_X

LEFT_RAIL_X = -.80
RIGHT_RAIL_X = LADDER_RAIL_X[1]
LEFT_DISPLACEMENT = LEFT_RAIL_X - LADDER_RAIL_X[0]
SUPPORTS = ('Pool ladder crest landing',
            *(f'Pool {side} ladder tread {i}' for side in ('outside', 'inside') for i in range(1, 4)))
LEFT_HARDWARE = ('Pool ladder rail 1', 'Pool ladder stringer 1 1', 'Pool ladder stringer 1 1 upper')


def support_edge(x):
    for old, new in zip(LADDER_RAIL_X, (LEFT_RAIL_X, RIGHT_RAIL_X)):
        if abs(x-old) < 1e-6:
            return new
    raise ValueError(f'Unexpected lateral tread edge: {x}')


def expected_x(name, x):
    if name in LEFT_HARDWARE:
        return x + LEFT_DISPLACEMENT
    return support_edge(x) if name in SUPPORTS else x
