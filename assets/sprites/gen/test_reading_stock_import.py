import copy
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from reading_stock import StockTableWriter
from reading_stock_import import StockTableImporter, stock_scene


def manifest(high=None, low=None):
    rows = [dict(row=index // 64, state=index % 64, high=None, low=None) for index in range(256)]
    rows[1].update(high=high, low=low)
    zero = [dict(row=index // 64, state=index % 64, high=None, low=None) for index in range(256)]
    return dict(shelfAnchor=[48, 116], stockTables={
        'SW': dict(kind='stock', facing='SW', canvas=[96, 120], encoding='scene-linear-premultiplied-signed16', rows=rows),
        'zero': dict(kind='occlusion', facing='SW', canvas=[96, 120],
                     encoding='scene-linear-premultiplied-signed16', rows=zero, visibilitySHA='a' * 64)})


class StockImport(unittest.TestCase):
    def test_imports_registered_coefficients_and_reuses_identical_tables(self):
        with tempfile.TemporaryDirectory() as folder:
            value = np.zeros((4, 4, 3), np.float32)
            value[1, 1] = [.2, -.3, .5]
            high, low = StockTableWriter(folder).pair(value, (10, 20))
            data = manifest(high, low)
            sprites, anchors, densities, trims = [], {}, {}, {}
            importer = StockTableImporter(sprites, anchors, densities, trims)
            tables = importer.manifest(folder, data)
            self.assertEqual(len(sprites), 2)
            self.assertEqual(trims[0], [5, 10])
            self.assertEqual(densities[0], 2)
            importer.manifest(folder, copy.deepcopy(data))
            self.assertEqual(len(sprites), 2)
            self.assertEqual(len(importer.tables), 2)
            row = dict(facing='SW', canvas=[124, 128], anchor=[62, 116], stockTable='SW',
                       stockCorrection='zero', stockVisibilitySHA='a' * 64)
            self.assertEqual(stock_scene(row, data, tables), dict(stock=0, canvas=[96, 120], offset=[14, 0]))
            with self.assertRaisesRegex(ValueError, 'matching'):
                stock_scene(dict(row, facing='NE'), data, tables)
            with self.assertRaisesRegex(ValueError, 'source visibility'):
                stock_scene(dict(row, stockCorrection=None), data, tables)
            with self.assertRaisesRegex(ValueError, 'source visibility'):
                stock_scene(dict(row, stockVisibilitySHA='b' * 64), data, tables)

    def test_rejects_phantom_empty_stock_and_missing_states(self):
        importer = StockTableImporter([], {}, {}, {})
        data = manifest()
        data['stockTables']['SW']['rows'][0].update(high={}, low={})
        with self.assertRaisesRegex(ValueError, 'empty state'):
            importer.manifest('.', data)
        data = manifest()
        data['stockTables']['SW']['rows'].pop()
        with self.assertRaisesRegex(ValueError, 'contract'):
            importer.manifest('.', data)

    def test_rejects_a_validly_hashed_texture_without_filter_padding(self):
        with tempfile.TemporaryDirectory() as folder:
            writer = StockTableWriter(folder)
            high = Image.new('RGBA', (3, 3), (128, 128, 128, 255))
            high.putpixel((0, 1), (129, 128, 128, 255))
            low = Image.new('RGBA', (3, 3), (0, 0, 0, 255))
            data = manifest(writer.image(high, [10, 20, 13, 23]), writer.image(low, [10, 20, 13, 23]))
            with self.assertRaisesRegex(ValueError, 'neutral interpolation border'):
                StockTableImporter([], {}, {}, {}).manifest(Path(folder), data)


if __name__ == '__main__':
    unittest.main()
