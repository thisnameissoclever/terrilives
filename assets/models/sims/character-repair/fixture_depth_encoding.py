"""Encode registered fixture depth as an unsigned 16-bit value in red and green."""

import numpy as np

# The old three-tile tag is 128. Larger limits use consecutive byte values.
def range_tag(depth_range):
    if depth_range not in range(2, 8):
        raise ValueError('Unsupported registered fixture depth range')
    return 0 if depth_range == 2 else 128 + depth_range - 3


def encode_fixture_depth(values, covered, depth_range):
    tag = range_tag(depth_range)
    valid = values[covered]
    if (not valid.size or not np.isfinite(valid).all()
            or valid.min() < -depth_range or valid.max() > depth_range):
        raise ValueError(f'Physical source depth exceeds the signed [-{depth_range}, {depth_range}] contract')
    encoded = np.rint((np.nan_to_num(values) + depth_range) / (2 * depth_range) * 65535).astype(np.uint16)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = encoded >> 8
    rgba[:, :, 1] = encoded & 255
    rgba[:, :, 2] = covered.astype(np.uint8) * tag
    rgba[:, :, 3] = covered.astype(np.uint8) * 255
    return rgba


def decode_fixture_depth(pixels, depth_range):
    tag = range_tag(depth_range)
    covered = pixels[:, :, 3] > 0
    expected_blue = covered.astype(np.uint8) * tag
    if not np.array_equal(pixels[:, :, 2], expected_blue):
        raise ValueError('Registered fixture depth range flag differs from its record')
    encoded = pixels[:, :, 0].astype(np.uint16) * 256 + pixels[:, :, 1]
    return encoded / 65535 * (2 * depth_range) - depth_range
