"""Guard every decoded record shipped before the furniture append."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
# HD/legacy records 0..835 from 857c549, architecture 836..848 from
# origin/main 1631863. Verified against those committed PNG crops separately.
PREFIX_COUNT = 849
PREFIX_SHA256 = "2d89f84686907bb452cd6410ee520c09b6b3072796870086ae84a8904dc5318b"


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
    def test_preserves_all_849_prior_names_dimensions_density_and_pixels(self):
        self.assertEqual(prefix_digest(), PREFIX_SHA256)


if __name__ == "__main__":
    unittest.main()
