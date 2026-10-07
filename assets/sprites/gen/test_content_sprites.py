"""The art importer resolves sprite inheritance without interpreting gameplay."""
from pathlib import Path
import tomllib
import unittest

from content_sprites import model_sprites


class ContentSpriteTests(unittest.TestCase):
    def fixture(self):
        return dict(category=[dict(id='seating', properties=dict(sprite=dict(set='family')))],
                    object_type=[dict(id='chair', category='seating')],
                    model=[dict(id='basic', object_type='chair'), dict(id='deluxe', object_type='chair')])

    def test_all_three_layers_resolve_and_model_identity_is_preserved(self):
        data = self.fixture()
        self.assertEqual(model_sprites(data), dict(basic='family', deluxe='family'))
        data['object_type'][0]['properties'] = dict(sprite=dict(set='chairSprite'))
        data['model'][1]['properties'] = dict(sprite=dict(set='deluxeSprite'))
        self.assertEqual(model_sprites(data), dict(basic='chairSprite', deluxe='deluxeSprite'))

    def test_flat_content_remains_supported(self):
        self.assertEqual(model_sprites(dict(object=[dict(id='old', sprite='oldSprite')])),
                         dict(old='oldSprite'))

    def test_invalid_required_scalar_operations_fail(self):
        for operation in (dict(remove=True), dict(scale=2), dict(replace='x'),
                          dict(extend='x'), dict(set='x', remove=True), dict(set=42), dict(unknown='x')):
            with self.subTest(operation=operation):
                data = self.fixture()
                data['model'][0]['properties'] = dict(sprite=operation)
                with self.assertRaises(ValueError):
                    model_sprites(data)

    def test_missing_parent_missing_sprite_and_duplicate_identity_fail(self):
        for mutation in ('type', 'category', 'sprite', 'duplicate'):
            with self.subTest(mutation=mutation):
                data = self.fixture()
                if mutation == 'type':
                    data['model'][0]['object_type'] = 'missing'
                elif mutation == 'category':
                    data['object_type'][0]['category'] = 'missing'
                elif mutation == 'sprite':
                    data['category'][0]['properties'] = {}
                else:
                    data['model'].append(data['model'][0])
                with self.assertRaises(ValueError):
                    model_sprites(data)

    def test_shipped_models_bind_to_their_authored_sprites(self):
        path = Path(__file__).resolve().parents[3] / 'content/objects.toml'
        data = tomllib.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(model_sprites(data), {
            model['id']: model['properties']['sprite']['set'] for model in data['model']})


if __name__ == '__main__':
    unittest.main()
