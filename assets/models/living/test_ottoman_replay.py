"""Pin stage inputs so replay cannot mix new and accepted output journals."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ottoman_bundle import load_bundle
from ottoman_replay import prepare_stage, run_commands, blender_command

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'assets/models/living/owner-review-pending/ottoman/sitting-02/bundle.json'
BASE = 'output/ottoman-sit-candidate-02/'


class OttomanReplayTests(unittest.TestCase):
    def test_each_stage_seeds_inputs_but_not_its_outputs(self):
        bundle = load_bundle(CATALOG, root=ROOT)
        stages = {
            'source-tests': ({BASE + 'contributions/raw-proof.json'},
                             {BASE + 'ottoman-sit-authoring.blend', BASE + 'offline-export'}),
            'contact': ({BASE + 'ottoman-sit-authoring.blend', BASE + 'status.json'},
                        {BASE + 'strict-contact-proof-02.json', BASE + 'contributions',
                         BASE + 'occupancy-regression-proof.json'}),
            'render': ({BASE + 'ottoman-sit-authoring.blend', BASE + 'strict-contact-proof-02.json'},
                       {BASE + 'contributions', BASE + 'offline-export', BASE + 'action-cadence.json'}),
            'author': ({'output/build-ottoman-sit-refined.py'}, {BASE.rstrip('/')}),
        }
        for stage, (present, absent) in stages.items():
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / 'fresh'
                prepare_stage(bundle, stage, target)
                for name in present:
                    self.assertTrue((target / name).is_file(), name)
                for name in absent:
                    self.assertFalse((target / name).exists(), name)
                with self.assertRaises(FileExistsError):
                    prepare_stage(bundle, stage, target)

    def test_changed_source_and_resigned_catalog_leave_a_failed_journal(self):
        for exit_code, resign in ((0, True), (1, True), (0, False)):
            with self.subTest(exit_code=exit_code, resign=resign), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / 'assets/author.py'
                archive.parent.mkdir()
                archive.write_bytes(b'accepted')
                catalog = root / 'assets/bundle.json'
                data = {'version': 1, 'asset': 'ottoman_sit', 'files': [{
                    'historical': 'output/author.py', 'path': 'assets/author.py',
                    'sha256': hashlib.sha256(b'accepted').hexdigest()}]}
                catalog.write_text(json.dumps(data))
                bundle = load_bundle(catalog, root=root)
                destination = root / 'replay'
                destination.mkdir()

                def changed_source(argv, **kwargs):
                    archive.write_bytes(b'changed')
                    if resign:
                        data['files'][0]['sha256'] = hashlib.sha256(b'changed').hexdigest()
                        catalog.write_text(json.dumps(data))
                    return subprocess.CompletedProcess(argv, exit_code, 'retained stdout', 'retained stderr')

                with patch('ottoman_replay.subprocess.run', side_effect=changed_source):
                    with self.assertRaises(RuntimeError):
                        run_commands(bundle, catalog, 'source-tests', destination, [['python', 'test.py']], {})
                report = json.loads((destination / 'replay-result.json').read_text())
                self.assertEqual(report['state'], 'failed')
                self.assertFalse(report['archive_bytes_unchanged'])
                self.assertEqual(report['commands'][0]['stdout'], 'retained stdout')
                self.assertEqual(report['commands'][0]['exit_code'], exit_code)
                self.assertIn('archive_error', report)
                if exit_code:
                    self.assertIn('error', report)

    def test_blender_probe_and_recipe_use_the_same_absolute_executable(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            executable = Path(directory) / 'blender.exe'
            executable.write_bytes(b'fixture only')
            relative = Path(os.path.relpath(executable))
            result = subprocess.CompletedProcess([], 0,
                'OTTOMAN_ENGINE=["4.5.14 LTS", "62c1db4208e8"]\n', '')
            with patch('ottoman_replay.subprocess.run', return_value=result) as invoke:
                command = blender_command(relative, {})
            self.assertEqual(invoke.call_args.args[0][0], str(executable.resolve()))
            self.assertEqual(command[0], str(executable.resolve()))


if __name__ == '__main__':
    unittest.main()
