"""Higher-precision E2 row differences in two ordinary opaque RGBA8 textures."""
import numpy as np
from PIL import Image

SCALE = 32767
BIAS = 32768
NEUTRAL_HIGH = 128
NEUTRAL_LOW = 0
NEUTRAL_SNAP_CODES = np.float32(1/16)
MODELED_FLOAT32_ERROR_CODES = 1/8
TARGET_SIZE = (192, 240)


def legacy_precision(image, size=TARGET_SIZE):
    """Defer target colour rounding while retaining Pillow's legacy path.

    Pillow's RGBA Lanczos path first converts source bytes to RGBa, filters,
    then converts back. Keep that exact source conversion and the exact legacy
    target alpha. Float Lanczos colour channels defer per-image target rounding.
    Saturation matches the bounded straight RGB output domain. No linear-light
    conversion, new filter, lighting adjustment or alpha convention is used.
    """
    if image.mode != 'RGBA':
        raise ValueError('Expected unchanged RGBA source')
    legacy = np.asarray(image.resize(size, Image.Resampling.LANCZOS)).copy()
    associated = np.asarray(image.convert('RGBa'), dtype=np.float32)
    filtered = np.stack([np.asarray(Image.fromarray(associated[:, :, band]).resize(size, Image.Resampling.LANCZOS))
                         for band in range(3)], axis=2)
    alpha_bytes = legacy[:, :, 3:4].astype(np.float32)
    straight = np.divide(filtered, alpha_bytes, out=np.zeros_like(filtered), where=alpha_bytes > 0)
    diagnostics = {'pre_saturation_min': float(straight.min()), 'pre_saturation_max': float(straight.max()),
                   'pre_saturation_negative_components': int(np.count_nonzero(straight < 0)),
                   'pre_saturation_over_one_components': int(np.count_nonzero(straight > 1))}
    return np.clip(straight, 0, 1), legacy, diagnostics


def row_difference(base, row, size=TARGET_SIZE):
    if base.size != row.size or base.mode != 'RGBA' or row.mode != 'RGBA':
        raise ValueError('Expected matching source RGBA images')
    if not np.array_equal(np.asarray(base)[:, :, 3], np.asarray(row)[:, :, 3]):
        raise ValueError('Source alpha differs; fixed base alpha is not valid')
    b, b8, bd = legacy_precision(base, size)
    r, r8, rd = legacy_precision(row, size)
    if not np.array_equal(b8[:, :, 3], r8[:, :, 3]):
        raise ValueError('Legacy target alpha differs; do not discard an alpha contribution')
    return r-b, b8, {'base': bd, 'row': rd}


def encode(delta):
    values = np.asarray(delta, dtype=np.float64)
    if values.shape[-1] != 3 or not np.all(np.isfinite(values)) or np.any(np.abs(values) > 1):
        raise ValueError('Expected finite RGB differences in [-1,1]')
    code = np.floor(values*SCALE+.5).astype(np.int32)
    unsigned = (code+BIAS).astype(np.uint16)
    high = np.empty((*values.shape[:-1], 4), dtype=np.uint8)
    low = np.empty_like(high)
    high[..., :3], low[..., :3] = unsigned >> 8, unsigned & 255
    # Data alpha must stay opaque: transparent-pixel cleanup cannot erase codes.
    high[..., 3], low[..., 3] = 255, 255
    return high, low


def decode(high_sample, low_sample):
    h = np.asarray(high_sample, dtype=np.float32)[..., :3]
    l = np.asarray(low_sample, dtype=np.float32)[..., :3]
    codes = ((h*np.float32(255)-np.float32(128))*np.float32(256)
             +l*np.float32(255))
    # Constant neutral texels can acquire a tiny floating interpolation residue.
    # This explicit zero deadband is included in the analytical error bound.
    codes = np.where(np.abs(codes) <= NEUTRAL_SNAP_CODES, np.float32(0), codes)
    return codes/np.float32(SCALE)


def crop_encoded(high, low, apron=2):
    if high.shape != low.shape or high.shape[-1] != 4:
        raise ValueError('Expected matched encoded textures')
    changed = np.any(high[:, :, :3] != NEUTRAL_HIGH, axis=2) | np.any(low[:, :, :3] != NEUTRAL_LOW, axis=2)
    yy, xx = np.nonzero(changed)
    if not len(xx):
        return None
    x0, y0 = max(0, int(xx.min())-apron), max(0, int(yy.min())-apron)
    x1, y1 = min(high.shape[1], int(xx.max())+apron+1), min(high.shape[0], int(yy.max())+apron+1)
    return [x0, y0, x1-x0, y1-y0], high[y0:y1, x0:x1].copy(), low[y0:y1, x0:x1].copy()


def bounds(row_count=4):
    encoding = .5/SCALE
    modeled_float = MODELED_FLOAT32_ERROR_CODES/SCALE
    neutral_snap = float(NEUTRAL_SNAP_CODES)/SCALE
    return {'scale': SCALE, 'encoding_error_per_row': encoding,
            'modeled_float32_error_per_row': modeled_float, 'neutral_snap_error_per_row': neutral_snap,
            'row_count': row_count, 'sum_error_before_colourway': row_count*(encoding+modeled_float+neutral_snap),
            'sum_error_in_255_units_before_colourway': row_count*(encoding+modeled_float+neutral_snap)*255,
            'scope': 'Codec error under nonnegative normalized bilinear weights and the stated float32 arithmetic model; excludes row interaction, legacy base/reference rounding and nonlinear colourway amplification.'}
