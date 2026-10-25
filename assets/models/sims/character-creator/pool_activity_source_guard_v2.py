"""Require exact published serialization for every pool sample without positive authoring."""
import math


def require_pool_published_sample(actual, published, authoring, clip, index):
    if not isinstance(authoring, dict):
        raise ValueError('Pool source requires actual authoring weights')
    positive = False
    if authoring:
        weights = authoring.get('weights')
        if not isinstance(weights, dict) or not weights or any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1 for value in weights.values()):
            raise ValueError('Pool source requires finite actual authoring weights')
        positive = any(value > 0 for value in weights.values())
    if not positive and actual != published:
        raise ValueError(f'Pool zero-weight output differs from published serialization: {clip}/{index}')
    return not positive
