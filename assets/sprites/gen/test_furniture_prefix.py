"""Guard every decoded record shipped before the furniture append."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PREFIX_COUNT = 847
PREFIX_SHA256 = "9ca251b7d7c6834db6fee488546bd4e50cacb49253660698843e84dc3da9703c"


def prefix_digest():
    manifest = tomllib.loads((ROOT / "assets/sprites/atlas.toml").read_text())
    records = manifest["sprite"][:PREFIX_COUNT]
    if len(records) != PREFIX_COUNT:
        raise ValueError("missing preserved atlas prefix")
    digest = hashlib.sha256()
    with Image.open(ROOT / "web/public/atlas.png") as atlas:
        for row in records:
            metadata = [row["name"], row["w"], row["h"], row.get("pixel_density", 1)]
            digest.update(json.dumps(metadata, separators=(",", ":")).encode())
            digest.update(atlas.crop((row["x"], row["y"], row["x"] + row["w"], row["y"] + row["h"])).tobytes())
    return digest.hexdigest()


class FurniturePrefixTests(unittest.TestCase):
    def test_preserves_all_847_prior_names_dimensions_density_and_pixels(self):
        self.assertEqual(prefix_digest(), PREFIX_SHA256)


if __name__ == "__main__":
    unittest.main()
