"""Read the correct page and reject crops Pillow would silently pad."""
import importlib
from pathlib import Path
import tempfile
import unittest
from PIL import Image


class AtlasPixelTests(unittest.TestCase):
    def reader(self, root, manifest):
        try:
            module = importlib.import_module('atlas_pixels')
        except ModuleNotFoundError:
            self.fail('Missing the page-aware atlas pixel reader')
        return module.AtlasPages(root, manifest=manifest)

    def test_page_identity_is_independent_of_shared_rectangle_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'web/public').mkdir(parents=True)
            Image.new('RGBA', (4, 4), (255, 0, 0, 255)).save(root/'web/public/red.png')
            Image.new('RGBA', (4, 4), (0, 0, 255, 255)).save(root/'web/public/blue.png')
            with self.reader(root, {'pages': ['red.png', 'blue.png'], 'width': 4, 'height': 4}) as atlas:
                row = {'x': 0, 'y': 0, 'w': 2, 'h': 2}
                self.assertEqual(atlas.crop(row).getpixel((0, 0)), (255, 0, 0, 255))
                self.assertEqual(atlas.crop(dict(row, page=1)).getpixel((0, 0)), (0, 0, 255, 255))
                for bad in (dict(row, page=2), dict(row, x=3), dict(row, page=-1)):
                    with self.assertRaises(ValueError):
                        atlas.crop(bad)

    def test_legacy_single_page_and_path_containment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'web/public').mkdir(parents=True)
            Image.new('RGBA', (4, 4)).save(root/'web/public/atlas.png')
            with self.reader(root, {'image': 'atlas.png', 'width': 4, 'height': 4}) as atlas:
                self.assertEqual(atlas.crop({'x': 0, 'y': 0, 'w': 4, 'h': 4}).size, (4, 4))
            with self.reader(root, {'pages': ['../outside.png'], 'width': 4, 'height': 4}) as atlas:
                with self.assertRaises(ValueError):
                    atlas.page(0)


if __name__ == '__main__':
    unittest.main()
