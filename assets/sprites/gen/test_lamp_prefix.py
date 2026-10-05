"""The lamp appends after every published armchair record and preserves older data."""
import hashlib
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages

EXPECTED_METADATA = {
    'SPRITE_ANCHORS': (936, '5529c2c7a057261f6145300e4ac95fe462c17383a1e7ed297f549486fad47352'),
    'SPRITE_CONTENT_TOPS': (716, 'ec9ca0cb53f576c1675e5fd37ccf3576e6f95ca09832ec9d74b5b401ae3ed34c'),
    'SPRITE_CONTENT_BOUNDS': (499, '2170b75fc7c85022f4969d5b62a1437ffbe45a601c38042801527f2700f98c7b'),
    'SPRITE_PAIRS': (240, 'bae5d03b7e2fb459fbe6dc9f962da206799cccbf886220bd4d0dab75acce6cfc'),
    'INTERACTION_SPRITES': (16, 'cdb23229084fe45e97a3fe3a79285a607a4266cc033c9b4005de389258dd49cf'),
    'SPRITE_HAND_ANCHORS': (48, '44a758ed55f551cfe734ec20cf03608f951a4666873d266ed6d24bc45fc85e76'),
    'SPRITE_HAND_FOREGROUND': (48, '92e3ec14b47074f23dc72bc43083966b57e768915425e2c160187e38ec5b0d50'),
    'RIGGED_SIM_CLIPS': (10, 'd8ec8a721fc7a86da06d15eb2ee23127063032ad3582c369ee32a4a881648d7e'),
    'RIGGED_SIM_VARIANTS': (3, '9257eabac4f92eb645dc50839ca752fd245e91115be4b20116f70098f352e0c2'),
}


def preserved_table(source, name, cutoff=1346):
    match = re.search(r'^export const '+re.escape(name)+r'\b[^\n]*=\s*(\{.*?^\});', source, re.M | re.S)
    if match is None:
        raise ValueError('Missing table: '+name)
    body = re.sub(r'(?m)^(\s*)(\d+):', r'\1"\2":', match.group(1))
    value = json.loads(re.sub(r',\s*([}\]])', r'\1', body))
    if name not in ('RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS'):
        value = {key: item for key, item in value.items() if int(key) < cutoff}
        if name == 'INTERACTION_SPRITES':
            value = {key: item for key, item in value.items()
                     if all(index < cutoff for frames in item['frames'].values() for index in frames)}
    else:
        def published_clips(clips):
            return {key: clip for key, clip in clips.items()
                    if all(index < cutoff for facing in clip['frames'] for index in facing)}
        value = (published_clips(value) if name == 'RIGGED_SIM_CLIPS' else
                 {variant: published_clips(clips) for variant, clips in value.items()})
    return value


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class LampPrefixTests(unittest.TestCase):
    def test_keeps_all_1346_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1346:1350]],
                         ['offlineFloorLamp'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1346]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '5bb69041d92d148d77878a4ee007148f8341ed0e42cccb46e14df30d1a8d2cf1')
        for row in rows[1346:1350]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_prior_registration_and_interaction_metadata(self):
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in EXPECTED_METADATA.items():
            with self.subTest(table=name):
                value = preserved_table(source, name)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
