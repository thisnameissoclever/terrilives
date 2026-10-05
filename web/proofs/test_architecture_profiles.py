"""The benchmark appearance must follow real content, not duplicate constants."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('benchmark_prepare', HERE / 'prepare-architecture-baseline.py')
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class AppearanceProfileTests(unittest.TestCase):
    def test_fixture_matches_current_content_and_preserves_old_altered_profile(self):
        source = (PREPARE.ROOT / 'content' / 'lot.toml').read_bytes()
        expected = PREPARE.appearance_profiles(source)
        actual = json.loads(PREPARE.PROFILE.read_text())
        self.assertEqual(actual, expected)
        self.assertEqual(actual['source']['sha256'], hashlib.sha256(source).hexdigest())
        self.assertEqual(actual['profiles']['altered-zero-look']['coveringLooks'], [0.0] * 9)
        self.assertNotEqual(actual['profiles']['shipped-content']['coveringLooks'], [0.0] * 9)

    def test_content_change_changes_generated_values_and_identity(self):
        source = (PREPARE.ROOT / 'content' / 'lot.toml').read_bytes()
        changed = source.replace(b'strength = 1.15', b'strength = 1.25', 1)
        self.assertNotEqual(changed, source)
        before = PREPARE.appearance_profiles(source)
        after = PREPARE.appearance_profiles(changed)
        self.assertEqual(after['profiles']['shipped-content']['coveringLooks'][1], 1.25)
        self.assertNotEqual(before['source']['sha256'], after['source']['sha256'])
        self.assertEqual(before['profiles']['altered-zero-look'], after['profiles']['altered-zero-look'])


if __name__ == '__main__':
    unittest.main()
