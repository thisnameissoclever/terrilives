"""Exercise export validation with real PNG bytes, not production artwork."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from offline_furniture import load_furniture, furniture_tables, validate_pairs
import build


class FurnitureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        image = Image.new("RGBA", (192, 240))
        image.putpixel((50, 20), (20, 30, 40, 80))
        image.save(self.root / "sample.png")
        self.ref = {"path": "sample.png", "sha256": hashlib.sha256((self.root / "sample.png").read_bytes()).hexdigest()}
        self.data = {"version": 1, "pixel_density": 2, "width": 96, "height": 120,
                     "anchor": [48.00001, 116.00044], "empty": [], "frames": []}
        for obj, count in (("bike", 8), ("chair", 4)):
            for facing in ("SE", "NW", "SW", "NE"):
                self.data["empty"].append({"object": obj, "facing": facing, **self.ref})
                for frame in range(count):
                    for variant in ("green", "blue", "red"):
                        self.data["frames"].append({"object": obj, "facing": facing, "frame": frame,
                            "variant": variant, "body": dict(self.ref), "furniture": dict(self.ref), "outline": dict(self.ref)})

    def load(self):
        path = self.root / "manifest.json"
        path.write_text(json.dumps(self.data), encoding="utf-8")
        return load_furniture(path)

    def test_complete_export_deduplicates_layers_not_body_identity(self):
        export = self.load()
        self.assertEqual(len(export.sprites), 154)  # 8 empty + 144 bodies + 2 shared layers.
        sprites = [("prefix", Image.new("RGBA", (1, 1)), 1, 1)] + export.sprites
        anchors, tops, bounds, density, pairs, catalog = furniture_tables(export, sprites)
        self.assertEqual(len(pairs), 144)
        self.assertEqual(len(catalog), 8)
        self.assertEqual(len(density), 154)
        self.assertTrue(all(v == [25, 10, 25.5, 10.5] for v in bounds.values()))
        self.assertEqual(len({p["furniture"] for p in pairs.values()}), 1)
        self.assertEqual(len({p["outline"] for p in pairs.values()}), 1)
        self.assertEqual(catalog[1]["action"], 6)
        self.assertEqual(len(catalog[1]["frames"]["blue"]), 8)
        self.assertEqual(anchors[1], self.data["anchor"])

    def test_missing_or_duplicate_coverage_rejected(self):
        for field in ("empty", "frames"):
            original = copy.deepcopy(self.data[field])
            self.data[field].pop()
            with self.assertRaisesRegex(ValueError, "coverage"):
                self.load()
            self.data[field] = original + [original[0]]
            with self.assertRaisesRegex(ValueError, "duplicate"):
                self.load()
            self.data[field] = original

    def test_bad_hash_path_and_dimensions_rejected(self):
        for change, message in (({"sha256": "0" * 64}, "hash"), ({"path": "../sample.png"}, "path"),
                                ({"path": "folder\\sample.png"}, "path")):
            self.data["frames"][0]["body"].update(change)
            with self.assertRaisesRegex(ValueError, message):
                self.load()
            self.data["frames"][0]["body"] = dict(self.ref)
        Image.new("RGBA", (96, 120)).save(self.root / "small.png")
        self.data["frames"][0]["body"] = {"path": "small.png", "sha256": hashlib.sha256((self.root / "small.png").read_bytes()).hexdigest()}
        with self.assertRaisesRegex(ValueError, "192x240"):
            self.load()

    def test_registration_rejected(self):
        for key, value in (("width", 95), ("height", 119), ("pixel_density", 1), ("anchor", [48, 112])):
            original = self.data[key]
            self.data[key] = value
            with self.assertRaises(ValueError):
                self.load()
            self.data[key] = original
        self.data["frames"][0]["body"]["anchor"] = [48, 110]
        with self.assertRaisesRegex(ValueError, "registration"):
            self.load()

    def test_transparent_empty_and_straight_alpha_contributions_are_rejected(self):
        Image.new("RGBA", (192, 240)).save(self.root / "blank.png")
        ref = {"path": "blank.png", "sha256": hashlib.sha256((self.root / "blank.png").read_bytes()).hexdigest()}
        self.data["empty"][0].update(ref)
        with self.assertRaisesRegex(ValueError, "visible"):
            self.load()
        self.data["empty"][0].update(self.ref)
        Image.new("RGBA", (192, 240), (100, 0, 0, 40)).save(self.root / "straight.png")
        self.data["frames"][0]["outline"] = {"path": "straight.png", "sha256": hashlib.sha256((self.root / "straight.png").read_bytes()).hexdigest()}
        with self.assertRaisesRegex(ValueError, "premultiplied"):
            self.load()

    def test_manifest_requires_integer_version_density_and_sample_numbers(self):
        for key, bad in (("version", True), ("pixel_density", 2.0)):
            original = self.data[key]
            self.data[key] = bad
            with self.assertRaises(ValueError):
                self.load()
            self.data[key] = original
        self.data["frames"][0]["frame"] = False
        with self.assertRaises(ValueError):
            self.load()

    def test_pair_references_must_match_registration(self):
        export = self.load()
        tables = furniture_tables(export, export.sprites)
        anchors, _, _, density, pairs, _ = tables
        body = next(iter(pairs))
        pairs[body]["furniture"] = len(export.sprites)
        with self.assertRaisesRegex(ValueError, "index"):
            validate_pairs(export.sprites, anchors, density, pairs)
        tables = furniture_tables(export, export.sprites)
        anchors, _, _, density, pairs, _ = tables
        density[pairs[body]["furniture"]] = 1
        with self.assertRaisesRegex(ValueError, "registration"):
            validate_pairs(export.sprites, anchors, density, pairs)

    def test_pack_grows_width_before_exceeding_portable_height(self):
        records = [(f"sample{i}", None, 192, 240) for i in range(400)]
        _, width, height = build.pack_atlas(records)
        self.assertEqual((width, height), (4096, 4820))
        with self.assertRaisesRegex(ValueError, "height"):
            build.pack_atlas(records * 4 * 4)


if __name__ == "__main__":
    unittest.main()
