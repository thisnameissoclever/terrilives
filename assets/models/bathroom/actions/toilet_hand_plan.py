"""Bound the whole-hand translation needed for measured clothing clearance."""
from toilet_support_planner import finite_values


def vertical_hand_lift(gaps, desired_gap=.001, maximum_lift=.05):
    gaps = finite_values(gaps)
    finite_values((desired_gap, maximum_lift))
    if not 0 <= desired_gap <= maximum_lift:
        raise ValueError('Hand contact and gesture bounds are not ordered')
    lift = max(0, desired_gap-min(gaps))
    if lift > maximum_lift:
        raise ValueError('Measured hand correction exceeds the declared gesture range')
    return lift
