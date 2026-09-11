"""Break guards in isolated in-memory modules, run real tests, preserve source bytes."""
import hashlib
import io
from pathlib import Path
import types
import unittest

import test_geometry
import test_review_images

BASE = Path(__file__).resolve().parent


def main():
    jobs = [
        ('geometry.py','return -y, x, z','return y, x, z',
         test_geometry.FurnitureGeometryTests,'test_asymmetric_landmark_makes_four_rotations_not_mirrors'),
        ('geometry.py','(0 if side == \'L\' else math.pi)','0',
         test_geometry.FurnitureGeometryTests,'test_cranks_stay_on_opposite_sides_and_half_cycle_apart'),
        ('review_images.py','if set(images) != expected:','if False:',
         test_review_images.ReviewBatchTests,'test_missing_facing_is_rejected_not_drawn_as_blank'),
        ('review_images.py',"if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:",'if False:',
         test_review_images.ReviewBatchTests,'test_changed_png_is_rejected_before_review'),
    ]
    for filename,old,new,case,name in jobs:
        path = BASE/filename
        before = path.read_bytes()
        source = before.decode('utf-8')
        assert source.count(old) == 1
        module = types.ModuleType('mutation')
        module.__file__ = str(path)
        exec(compile(source.replace(old,new),str(path),'exec'),module.__dict__)
        original_geometry = test_geometry.FurnitureGeometryTests.geometry
        original_loader = test_review_images.load_checked
        try:
            if filename == 'geometry.py':
                test_geometry.FurnitureGeometryTests.geometry = lambda self: module
            else:
                test_review_images.load_checked = module.load_checked
            capture = io.StringIO()
            result = unittest.TextTestRunner(stream=capture).run(unittest.TestSuite([case(name)]))
            print(f'MUTATION: {filename}: {old} -> {new}')
            print(capture.getvalue())
            assert len(result.failures) == 1 and not result.errors, 'mutation escaped or failed for wrong reason'
        finally:
            test_geometry.FurnitureGeometryTests.geometry = original_geometry
            test_review_images.load_checked = original_loader
        assert path.read_bytes() == before
        print(f'PASS: detected; original binding restored; source bytes unchanged {hashlib.sha256(before).hexdigest()}')
    suite = unittest.defaultTestLoader.discover(str(BASE),pattern='test_*.py')
    result = unittest.TextTestRunner().run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
