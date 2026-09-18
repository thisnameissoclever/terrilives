"""A global append order keeps later rooms from renumbering earlier props."""
from pathlib import Path
import unittest

from offline_props import load_props

ROOT = Path(__file__).resolve().parents[3]


class StaticCatalogTests(unittest.TestCase):
    def test_global_catalog_preserves_the_accepted_kitchen_sequence(self):
        sprites,_,densities,_ = load_props(ROOT/'assets/models/static-props.json')
        expected = [name+suffix for name in
                    ('offlineFridge','offlineStove','offlineCounter','offlineSink')
                    for suffix in ('','NW','SW','NE')]
        self.assertEqual([row[0] for row in sprites[:16]],expected)
        self.assertEqual({densities[name] for name in expected},{2})


if __name__ == '__main__':
    unittest.main()
