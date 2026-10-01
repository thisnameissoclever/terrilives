"""Armchair additions preserve all 1270 earlier sprite records and decoded pixels."""
import hashlib
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image


EXPECTED_METADATA = {
    'SPRITE_ANCHORS': (860, 'e7c72c2fffb58693c9eaecfeb170dc7f4d1db8ad398cfc0dc13c567f3be72cc1'),
    'SPRITE_CONTENT_TOPS': (664, '7b7212e77c97f94a41385454bfae3eee45160cf0e9bce66d87b0a5b6526140d2'),
    'SPRITE_CONTENT_BOUNDS': (423, '7a2fb5a33068815b1b07bd0264937b40b5ca09f0354306ec571b244816460ba9'),
    'SPRITE_PAIRS': (192, 'b0872fceb71fa9ce01a90856e39bbf5b33bd0f6494d3a5e404e23e6e607878bc'),
    'INTERACTION_SPRITES': (12, '5a8502edc75856a74d47c536a7f20a46ed3d6699a5d444679f273ec996b4d5a0'),
    'SPRITE_HAND_ANCHORS': (48, '44a758ed55f551cfe734ec20cf03608f951a4666873d266ed6d24bc45fc85e76'),
    'SPRITE_HAND_FOREGROUND': (48, '92e3ec14b47074f23dc72bc43083966b57e768915425e2c160187e38ec5b0d50'),
    'RIGGED_SIM_CLIPS': (10, 'd8ec8a721fc7a86da06d15eb2ee23127063032ad3582c369ee32a4a881648d7e'),
    'RIGGED_SIM_VARIANTS': (3, '9257eabac4f92eb645dc50839ca752fd245e91115be4b20116f70098f352e0c2'),
}


def preserved_table(source, name):
    match = re.search(r'^export const '+re.escape(name)+r'\b[^\n]*=\s*(\{.*?^\});', source, re.M | re.S)
    if match is None:
        raise ValueError('Missing table: '+name)
    body = re.sub(r'(?m)^(\s*)(\d+):', r'\1"\2":', match.group(1))
    body = re.sub(r',\s*([}\]])', r'\1', body)
    value = json.loads(body)
    if name not in ('RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS'):
        if any(not key.isdecimal() for key in value):
            raise ValueError('Non-index key: '+name)
        value = {key: item for key, item in value.items() if int(key) < 1270}
    else:
        def published_clips(clips):
            return {key: clip for key, clip in clips.items()
                    if all(index < 1270 for facing in clip['frames'] for index in facing)}
        value = (published_clips(value) if name == 'RIGGED_SIM_CLIPS' else
                 {variant: published_clips(clips) for variant, clips in value.items()})
    return value


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class ArmchairPrefixTests(unittest.TestCase):
    def test_keeps_all_prior_registration_and_interaction_metadata(self):
        root = Path(__file__).resolve().parents[3]
        source = (root/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in EXPECTED_METADATA.items():
            with self.subTest(table=name):
                value = preserved_table(source, name)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)

    def test_keeps_all_1270_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1270:1274]],
                         ['offlineArmchair'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1270]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '99d9ccb1b3ae74c3a3e8a2a41618c4ca26a0e7fdf69e7f3ed9ccb4d8a3dabbe2')
        for row in rows[1270:1346]:
            self.assertTrue(row['name'].startswith('offlineArmchair'))
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))


if __name__ == '__main__':
    unittest.main()
