"""Supplemental provenance must reject drift and incomplete generation."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import render_provenance


class RenderProvenanceTests(unittest.TestCase):
    def test_dependency_drift_is_rejected(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)/'dependency-proof.json'
            proof = {'mode':'post-render-git-comparison','inputs':{'pose.py':'accepted'}}
            path.write_text(json.dumps(proof))
            with patch.object(render_provenance,'inputs',return_value={'pose.py':'changed'}):
                with self.assertRaisesRegex(ValueError,'dependencies'):
                    render_provenance.verify(directory)

    def test_incomplete_generation_cannot_be_exported(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)/'dependency-proof.json'
            proof = {'mode':'generation-start-and-end','state':'running','inputs':{'pose.py':'accepted'}}
            path.write_text(json.dumps(proof))
            with patch.object(render_provenance,'inputs',return_value=proof['inputs']):
                with self.assertRaisesRegex(ValueError,'incomplete'):
                    render_provenance.verify(directory)
                render_provenance.verify(directory,complete=False)
                proof['state'] = 'complete'
                path.write_text(json.dumps(proof))
                render_provenance.verify(directory)


if __name__ == '__main__':
    unittest.main()
