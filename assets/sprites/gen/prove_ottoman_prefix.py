"""Inject atlas data faults in memory and require the preservation tests to fail."""
import argparse
from contextlib import nullcontext
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image
import test_ottoman_sitting_prefix as tests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    root = tests.ROOT
    inputs = ['web/public/atlas.png', 'assets/sprites/atlas.toml', 'web/src/render/atlas.ts',
              'assets/sprites/gen/test_ottoman_sitting_prefix.py',
              'assets/sprites/gen/test_lamp_prefix.py']
    hashes = lambda: {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in inputs}
    before = hashes()
    crop = Image.Image.crop
    table = tests.preserved_table
    records = []

    def damaged_crop(image, *args, **kwargs):
        result = crop(image, *args, **kwargs)
        pixel = list(result.getpixel((0, 0)))
        pixel[0] ^= 1
        result.putpixel((0, 0), tuple(pixel))
        return result

    def damaged_table(source, name, cutoff=1346, *, defect):
        value = table(source, name, cutoff)
        if name == 'INTERACTION_SPRITES' and cutoff == 1450:
            if defect == 'cadence':
                value['1358']['halfCycleTicks'] = 24
            elif defect == 'facing':
                value['1358'], value['1359'] = value['1359'], value['1358']
        if name == 'SPRITE_ANCHORS' and defect == 'old_anchor':
            value[next(iter(value))][0] += .25
        return value

    cases = [
        ('old_pixel', 'test_preserves_1378_existing_records_and_decoded_pixels'),
        ('cadence', 'test_only_the_four_existing_ottoman_records_gain_profiles'),
        ('facing', 'test_only_the_four_existing_ottoman_records_gain_profiles'),
        ('old_anchor', 'test_existing_registration_and_other_interactions_are_unchanged'),
    ]
    for name, test in [('baseline', None), *cases, ('restored', None)]:
        capture = io.StringIO()
        if name == 'old_pixel':
            context = patch.object(Image.Image, 'crop', damaged_crop)
        elif test:
            context = patch.object(tests, 'preserved_table',
                                   lambda *args, **kwargs: damaged_table(*args, **kwargs, defect=name))
        else:
            context = nullcontext()
        suite = tests.OttomanSittingPrefixTests(test) if test else \
            unittest.defaultTestLoader.loadTestsFromTestCase(tests.OttomanSittingPrefixTests)
        with context:
            result = unittest.TextTestRunner(stream=capture).run(suite)
        if hashes() != before:
            raise AssertionError('Atlas or test source bytes changed')
        if test:
            if result.testsRun != 1 or not result.failures or result.errors or result.skipped:
                raise AssertionError(f'{name} did not fail its named assertion\n{capture.getvalue()}')
        elif result.testsRun != 3 or not result.wasSuccessful() or result.skipped:
            raise AssertionError(capture.getvalue())
        records.append({'case': name, 'test': test, 'output': capture.getvalue()})
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump({'state': 'complete', 'source_bytes_unchanged': True, 'inputs': before,
                   'cases': records}, stream, indent=2)
        stream.write('\n')
    print('PASS: four atlas faults detected; all three restored tests pass; source bytes unchanged')


if __name__ == '__main__':
    main()
