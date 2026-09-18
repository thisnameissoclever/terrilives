"""Prove static-prop guards reject deliberate in-memory implementation defects."""
import hashlib
import io
from pathlib import Path
import unittest

import offline_props
import test_offline_props

SOURCE = Path(offline_props.__file__)
MUTATIONS = (
    ('horizontal mirror', 'sprite = image.resize(texture_size,Image.Resampling.LANCZOS)',
     'sprite = image.resize(texture_size,Image.Resampling.LANCZOS).transpose(Image.Transpose.FLIP_LEFT_RIGHT)',
     'test_maps_four_actual_rotations_without_recentering_or_mirroring'),
    ('missing tile compensation', 'origin[1]/8+TILE_HALF_HEIGHT', 'origin[1]/8',
     'test_maps_four_actual_rotations_without_recentering_or_mirroring'),
    ('unbound review', "if reviewed_digest != entry.get('proof_sha256'):", 'if False:',
     'test_review_is_bound_to_exact_camera_and_render_provenance'),
    ('unchecked pixels', "if hashlib.sha256(source.read_bytes()).hexdigest() != row.get('sha256'):",
     'if False:', 'test_rejects_damaged_pixels'),
    ('wrong facing order', "{'SE':90, 'NW':270, 'SW':0, 'NE':180}",
     "{'SE':90, 'SW':0, 'NW':270, 'NE':180}",
     'test_maps_four_actual_rotations_without_recentering_or_mirroring'),
)


def run():
    source = SOURCE.read_text()
    original_bytes = SOURCE.read_bytes()
    original_loader = test_offline_props.load_props
    try:
        for label, old, new, test_name in MUTATIONS:
            if source.count(old) != 1:
                raise AssertionError(f'Mutation target changed: {label}')
            namespace = {'__file__':str(SOURCE),'__name__':'mutated_props'}
            exec(compile(source.replace(old,new),str(SOURCE),'exec'),namespace)
            test_offline_props.load_props = namespace['load_props']
            result = unittest.TextTestRunner(stream=io.StringIO()).run(
                unittest.TestSuite([test_offline_props.StaticPropTests(test_name)]))
            if result.wasSuccessful() or result.errors or not result.failures:
                raise AssertionError(f'Mutation was not caught by an assertion: {label}')
            print(f'CAUGHT: {label}: {result.failures[0][1].splitlines()[-1]}')
    finally:
        test_offline_props.load_props = original_loader
    if SOURCE.read_bytes() != original_bytes:
        raise AssertionError('Mutation run changed production source bytes')
    print('RESTORED: source SHA256 '+hashlib.sha256(original_bytes).hexdigest())
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromModule(test_offline_props))
    if not result.wasSuccessful():
        raise AssertionError('Unmutated suite failed')


if __name__ == '__main__':
    run()
