"""Import contracts for rendered Sim frames, independent of Blender."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

import build
from offline_sims import load_export, runtime_tables


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {
            "schema_version": 1, "width": 38, "height": 88,
            "anchor": [19, 88],
            "clips": {"walk": {
                "frame_count": 2, "sample_fps": 10,
                "loop": True, "source_action": "walk",
            }},
            "frames": [],
        }
        for facing in ("SE", "NW", "SW", "NE"):
            for frame in range(2):
                filename = f"walk-{facing}-{frame}.png"
                image = Image.new("RGBA", (38, 88), (0, 0, 0, 0))
                image.putpixel((19, 44), (120, 80, 40, 128 + frame))
                image.save(self.root / filename)
                self.manifest["frames"].append({
                    "name": f"rigSimWalk{facing}{frame}",
                    "action": "walk", "facing": facing, "frame": frame,
                    "path": filename,
                    "sha256": hashlib.sha256((self.root / filename).read_bytes()).hexdigest(),
                })

    def load(self, **kwargs):
        path = self.root / "manifest.json"
        path.write_text(json.dumps(self.manifest), encoding="utf-8")
        return load_export(path, **kwargs)

    def test_loads_complete_clip_without_changing_pixels(self):
        export = self.load(required_clips={"walk"})
        self.assertEqual(len(export.sprites), 8)
        self.assertEqual(export.sprites[0][1].getpixel((19, 44)), (120, 80, 40, 128))
        self.assertEqual(export.clips["walk"]["frame_count"], 2)

    def test_orders_frames_independently_of_manifest_row_order(self):
        expected = [row["name"] for row in self.manifest["frames"]]
        self.manifest["frames"].reverse()
        self.assertEqual([s[0] for s in self.load().sprites], expected)

    def test_named_shirt_variant_owns_names_and_runtime_indices(self):
        self.manifest["variant"] = "blue"
        self.manifest["clips"]["walk"]["distance_per_cycle_model_units"] = 1
        for row in self.manifest["frames"]:
            row["name"] = row["name"].replace("rigSim", "rigSimBlue")
        export = self.load(expected_variant="blue")
        self.assertEqual(export.sprites[0][0], "rigSimBlueWalkSE0")
        self.assertEqual(runtime_tables(export, export.sprites)[3]["walk"]["frames"][0], [0, 1])

    def test_rejects_wrong_or_unknown_shirt_variant(self):
        self.manifest["variant"] = "red"
        for row in self.manifest["frames"]:
            row["name"] = row["name"].replace("rigSim", "rigSimRed")
        with self.assertRaisesRegex(ValueError, "variant"):
            self.load(expected_variant="blue")
        self.manifest["variant"] = "pink"
        with self.assertRaisesRegex(ValueError, "variant"):
            self.load(expected_variant="pink")

    def test_rejects_missing_facing_or_frame(self):
        self.manifest["frames"].pop()
        with self.assertRaisesRegex(ValueError, "complete"):
            self.load()

    def test_rejects_missing_required_clip(self):
        with self.assertRaisesRegex(ValueError, "required"):
            self.load(required_clips={"walk", "eat"})

    def test_rejects_duplicate_and_legacy_names(self):
        self.manifest["frames"][1]["name"] = self.manifest["frames"][0]["name"]
        with self.assertRaisesRegex(ValueError, "name"):
            self.load()

    def test_rejects_name_collision_with_existing_atlas(self):
        with self.assertRaisesRegex(ValueError, "name"):
            self.load(existing_names={"rigSimWalkSE0"})

    def test_rejects_changed_source_bytes(self):
        self.manifest["frames"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash"):
            self.load()

    def test_rejects_path_outside_export(self):
        self.manifest["frames"][0]["path"] = "../outside.png"
        with self.assertRaisesRegex(ValueError, "inside"):
            self.load()

    def test_rejects_dimensions_anchor_and_rgb(self):
        for key, value in (("width", 39), ("height", 89)):
            with self.subTest(key=key):
                original = self.manifest[key]
                self.manifest[key] = value
                with self.assertRaisesRegex(ValueError, "38x88"):
                    self.load()
                self.manifest[key] = original
        self.manifest["anchor"] = [19, float('nan')]
        with self.assertRaisesRegex(ValueError, "base anchor"):
            self.load()
        self.manifest["anchor"] = [19, 88]
        row = self.manifest["frames"][0]
        path = self.root / row["path"]
        Image.new("RGB", (38, 88)).save(path)
        row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "RGBA"):
            self.load()

    def test_inherits_physical_base_anchor_and_resolves_runtime_tables(self):
        self.manifest["anchor"] = [19.00001, 100.0004]
        self.manifest["clips"]["walk"]["distance_per_cycle_model_units"] = 1
        export = self.load()
        anchors, hands, tops, clips, hand_fronts = runtime_tables(export, export.sprites)
        self.assertEqual(anchors[0], [19.00001, 100.0004])
        self.assertEqual(tops[0], 44)
        self.assertEqual(hands, {})
        self.assertEqual(hand_fronts, {})
        self.assertEqual(clips["walk"], {"frames": [[0, 1], [2, 3], [4, 5], [6, 7]], "cycleTiles": 1})

    def test_rejects_gait_cycle_that_cannot_meet_at_tile_corners(self):
        self.manifest["clips"]["walk"]["distance_per_cycle_model_units"] = 0.7
        export = self.load()
        with self.assertRaisesRegex(ValueError, "integer tile corners"):
            runtime_tables(export, export.sprites)

    def test_eating_requires_finite_visible_hand_and_exports_it(self):
        self.manifest["clips"]["eat"] = self.manifest["clips"].pop("walk")
        for row in self.manifest["frames"]:
            row.update(action="eat", name=row["name"].replace("Walk", "Eat"))
        with self.assertRaisesRegex(ValueError, "hand_anchor"):
            self.load()
        for row in self.manifest["frames"]:
            row["hand_anchor"] = [19.5, 44.25]
        with self.assertRaisesRegex(ValueError, "hand_in_front"):
            self.load()
        for row in self.manifest["frames"]:
            row["hand_in_front"] = row["facing"] != "NE"
        export = self.load()
        self.assertEqual(runtime_tables(export, export.sprites)[1][0], [19.5, 44.25])
        self.assertTrue(runtime_tables(export, export.sprites)[4][0])
        self.assertFalse(runtime_tables(export, export.sprites)[4][7])
        self.manifest["frames"][0]["hand_anchor"] = [19, 100]
        with self.assertRaisesRegex(ValueError, "hand_anchor"):
            self.load()

    def test_rejects_invalid_clip_timing(self):
        for rate in (0, -1, float("nan"), float("inf"), True):
            with self.subTest(rate=rate):
                self.manifest["clips"]["walk"]["sample_fps"] = rate
                with self.assertRaisesRegex(ValueError, "sample_fps"):
                    self.load()

    def test_registered_larger_canvas_preserves_world_scale_and_anchor(self):
        clip = self.manifest["clips"]["walk"]
        clip.update(width=52, height=104, anchor=[26, 96])
        for row in self.manifest["frames"]:
            path = self.root / row["path"]
            with Image.open(path) as source:
                padded = Image.new("RGBA", (52, 104))
                padded.paste(source, (7, 8))
            padded.save(path)
            row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        export = self.load()
        self.assertEqual(export.sprites[0][2:], (52, 104))
        self.assertEqual(export.sprites[0][1].getpixel((26, 52)), (120, 80, 40, 128))
        self.assertEqual(export.clips["walk"]["anchor"], [26, 96])

    def test_rejects_unregistered_or_unbounded_anchor(self):
        self.manifest["clips"]["walk"].update(width=52, height=104)
        with self.assertRaisesRegex(ValueError, "anchor"):
            self.load()
        self.manifest["clips"]["walk"]["anchor"] = [26, float("inf")]
        with self.assertRaisesRegex(ValueError, "anchor"):
            self.load()

    def test_ground_registration_can_be_fractional_and_beyond_crop(self):
        self.manifest["clips"]["walk"].update(width=38, height=88, anchor=[19, 99.25])
        self.assertEqual(self.load().clips["walk"]["anchor"], [19, 99.25])


class AtlasAlphaTests(unittest.TestCase):
    def test_compose_preserves_straight_rgba(self):
        source = Image.new("RGBA", (2, 1))
        source.putdata([(120, 80, 40, 128), (220, 170, 100, 255)])
        sheet = build.compose([("frame", source, 2, 1)], {0: (1, 1)}, 4, 3)
        self.assertEqual(sheet.crop((1, 1, 3, 2)).tobytes(), source.tobytes())
        self.assertEqual(sheet.getpixel((0, 0)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
