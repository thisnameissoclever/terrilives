"""An unfinished writer or a receipt outside the owned review directory must not create a bath export."""
from pathlib import Path
import tempfile
import unittest

from export_bath_loop import export, EXPORT_SIZE


class BathExportTests(unittest.TestCase):
    def test_live_source_writer_is_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'export'
            with self.assertRaises(ValueError):
                export(Path('missing-source.json'), Path('missing-ink.json'), output, process_exited=False)
            self.assertFalse(output.exists())

    def test_output_outside_the_owned_export_directory_is_refused(self):
        base = Path(__file__).parent
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'export'
            with self.assertRaises(ValueError):
                export(base/'review/bath/loop-02/proof.json', base/'review/bath/ink-02/proof.json', output,
                       process_exited=True)
            self.assertFalse(output.exists())

    def test_export_size_is_the_logical_canvas_at_density_two(self):
        self.assertEqual(EXPORT_SIZE, (320, 352))


if __name__ == '__main__':
    unittest.main()
