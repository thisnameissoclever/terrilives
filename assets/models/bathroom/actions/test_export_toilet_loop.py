"""An unfinished writer must not create an importable bathroom export."""
from pathlib import Path
import tempfile
import unittest

from export_toilet_loop import export, scene_anchor


class ToiletExportTests(unittest.TestCase):
    def test_live_source_writer_is_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'export'
            with self.assertRaises(ValueError):
                export(Path('missing-source.json'), Path('missing-ink.json'), output, process_exited=False)
            self.assertFalse(output.exists())

    def test_scene_anchor_drops_the_projected_origin_like_the_empty_fixture(self):
        # The static toilet and every neutral seat register at [48, 116] for a 192x240
        # source whose origin projects to [384, 760]: origin over eight, plus the tile drop.
        self.assertEqual(scene_anchor([384.0000915527344, 760.0034952163696]),
                         [48.0000114440918, 95.0004369020462+21])
        self.assertEqual(scene_anchor([384.0, 760.0]), [48.0, 116.0])


if __name__ == '__main__':
    unittest.main()
