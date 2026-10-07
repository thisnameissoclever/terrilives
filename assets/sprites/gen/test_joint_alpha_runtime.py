import base64
import hashlib
from pathlib import Path
import random
import struct
import tempfile
import unittest

from PIL import Image
from joint_alpha_runtime import joint_alpha


class JointAlphaRuntimeTests(unittest.TestCase):
    def test_half_float_coverage_matches_exact_source_block_averages(self):
        randomizer = random.Random(714)
        alpha = [randomizer.randrange(256) for _ in range(40 * 44)]
        image = Image.new('RGBA', (40, 44))
        image.putalpha(Image.frombytes('L', (40, 44), bytes(alpha)))
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'beauty.png'
            image.save(source)
            coverage = joint_alpha(source, [10, 11], hashlib.sha256(source.read_bytes()).hexdigest())
        expected = b''.join(struct.pack('<e', sum(
            alpha[(y * 4 + dy) * 40 + x * 4 + dx]
            for dy in range(4) for dx in range(4)) / (16 * 255))
            for y in range(11) for x in range(10))
        self.assertEqual(base64.b64decode(coverage['values']), expected)
        self.assertEqual(coverage['encoding'], 'float16')

    def test_invalid_source_hash_and_dimensions_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'beauty.png'
            Image.new('RGBA', (8, 8), (0, 0, 0, 255)).save(source)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'hash'):
                joint_alpha(source, [2, 2], '0' * 64)
            with self.assertRaisesRegex(ValueError, 'positive'):
                joint_alpha(source, [0, 2], digest)
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                joint_alpha(source, [3, 2], digest)
