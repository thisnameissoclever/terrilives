"""An unfinished writer must not create an importable bathroom export."""
from pathlib import Path
import tempfile
import unittest

from export_toilet_loop import export


class ToiletExportTests(unittest.TestCase):
    def test_live_source_writer_is_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'export'
            with self.assertRaises(ValueError):
                export(Path('missing-source.json'), Path('missing-ink.json'), output, process_exited=False)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
