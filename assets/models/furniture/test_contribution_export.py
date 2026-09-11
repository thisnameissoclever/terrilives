"""Coverage and reconstruction gates for production interaction textures."""
import unittest
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image

from export_contributions import expected_keys, compare_reconstruction, validate_signature, validate_ownership
from layer_partition import encode_contribution


class ContributionExportTests(unittest.TestCase):
    def test_shirt_changes_belong_to_body_not_furniture(self):
        blank = Image.new('RGBA',(2,2))
        prop = Image.new('RGBA',(2,2),(10,10,10,100))
        palettes = {variant:{'sim':Image.new('RGBA',(2,2),color),'furniture':prop,'lines':blank}
                    for variant,color in [('green',(20,80,20,100)),('blue',(20,20,80,100)),('red',(80,20,20,100))]}
        validate_ownership(palettes)
        swapped = {variant:{'sim':layers['furniture'],'furniture':layers['sim'],'lines':blank}
                   for variant,layers in palettes.items()}
        with self.assertRaisesRegex(ValueError,'ownership'):
            validate_ownership(swapped)
        for layers in palettes.values():
            layers['sim'] = blank
        with self.assertRaisesRegex(ValueError,'ownership'):
            validate_ownership(palettes)

    def test_signature_rejects_changed_sources_and_missing_scripts(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            source = base/'sim.blend'
            source.write_bytes(b'approved rig')
            names = ('render_contributions.py','animation_export.py','build_parts.py','geometry.py','preview.py')
            for name in names:
                (base/name).write_bytes(name.encode())
            digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            signature = {'source_sha256':digest(source),'density':8,'logical_canvas':[96,120],
                         'scripts':{name:digest(base/name) for name in names}}
            validate_signature(signature,base,source)
            (base/'geometry.py').write_bytes(b'changed geometry')
            with self.assertRaisesRegex(ValueError,'source'):
                validate_signature(signature,base,source)
            (base/'geometry.py').write_bytes(b'geometry.py')
            source.write_bytes(b'changed rig')
            with self.assertRaisesRegex(ValueError,'source'):
                validate_signature(signature,base,source)
            source.write_bytes(b'approved rig')
            del signature['scripts']['geometry.py']
            with self.assertRaisesRegex(ValueError,'signature'):
                validate_signature(signature,base,source)

    def test_expected_keys_include_every_palette_facing_sample_and_pass(self):
        keys = expected_keys()
        self.assertEqual(len(keys),584)
        self.assertIn(('bike','NE',7,'red','lines'),keys)
        self.assertIn(('chair','SW',3,'blue','sim'),keys)
        self.assertIn(('chair','NW',0,'green','empty'),keys)
        self.assertNotIn(('bike','SE',0,'red','empty'),keys)

    def test_missing_visible_body_fails_reconstruction(self):
        beauty = Image.new('RGBA',(4,4),(80,120,160,255))
        blank = Image.new('RGBA',(4,4))
        with self.assertRaisesRegex(ValueError,'reconstruction'):
            compare_reconstruction(beauty,blank,blank,blank)

    def test_opaque_visible_body_reconstructs_without_furniture(self):
        beauty = Image.new('RGBA',(4,4),(80,120,160,255))
        blank = Image.new('RGBA',(4,4))
        metrics = compare_reconstruction(beauty,encode_contribution(beauty,beauty.size),blank,blank)
        self.assertEqual(metrics['max_error'],0)


if __name__ == '__main__':
    unittest.main()
