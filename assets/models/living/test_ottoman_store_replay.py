"""Check the detached replay's file-based completion boundary."""
import json
import hashlib
import copy
import shutil
from pathlib import Path
import tempfile
import unittest

from ottoman_store_replay import inspect_result, prepare_job, collect_result, OUTPUTS
from ottoman_replay import ROOT, CATALOG
from ottoman_bundle import load_bundle, digest


class OttomanStoreReplayTests(unittest.TestCase):
    def test_a_launcher_return_without_a_blender_receipt_is_not_completion(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'request.json').write_text(json.dumps({'job_id': 'new-job'}))
            self.assertIsNone(inspect_result(directory))
            (directory / 'result.json').write_text(json.dumps({
                'state': 'complete', 'job_id': 'old-job'}))
            with self.assertRaisesRegex(ValueError, 'job identity', msg='job identity'):
                inspect_result(directory)

    def test_completion_requires_engine_resources_outputs_and_unchanged_copies(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / 'source'
            source.mkdir()
            (source / 'model.blend').write_bytes(b'original model')
            (directory / 'worker.py').write_bytes(b'worker')
            request = {'job_id': 'current', 'inputs': {
                'model.blend': hashlib.sha256(b'original model').hexdigest()},
                'worker_sha256': hashlib.sha256(b'worker').hexdigest()}
            request_path = directory / 'request.json'
            request_path.write_text(json.dumps(request))
            report = {'state': 'complete', 'job_id': 'current', 'pid': 123,
                'request_sha256': hashlib.sha256(request_path.read_bytes()).hexdigest(),
                'engine': ['4.5.14 LTS', '62c1db4208e8'], 'background': True,
                'source_bytes_unchanged': True,
                'resources': [{'model': 'model.blend', 'required_external_paths': []}],
                'outputs': {}}
            for name, data in {
                'output/ottoman-sit-candidate-02/strict-contact-proof-02.json': {
                    'state': 'complete', 'accepted': True, 'source_bytes_unchanged': True,
                    'samples': [{'frame': n} for n in range(1, 5)]},
                'output/ottoman-sit-candidate-02/occupancy-regression-proof.json': {
                    'state': 'complete', 'source_bytes_unchanged': True,
                    'cases': [{'name': str(n), 'passed': True} for n in range(7)]},
            }.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data))
                report['outputs'][name] = hashlib.sha256(path.read_bytes()).hexdigest()
            def write_report(value):
                (directory / 'result.json').write_text(json.dumps(value))
            write_report(report)
            self.assertEqual(inspect_result(directory)['state'], 'complete')
            defects = [({'engine': ['5.0', 'other']}, 'engine'),
                ({'background': False}, 'background'),
                ({'source_bytes_unchanged': False}, 'source bytes'),
                ({'request_sha256': '0'*64}, 'request hash'),
                ({'resources': []}, 'resource inventory'),
                ({'resources': [{'model': 'model.blend',
                    'required_external_paths': ['D:/outside/texture.png']}]}, 'external resources'),
                ({'outputs': {**report['outputs'], 'unexpected.json': '0'*64}}, 'output inventory')]
            for fields, message in defects:
                with self.subTest(fields=fields):
                    write_report({**report, **fields})
                    with self.assertRaisesRegex(ValueError, message, msg=message):
                        inspect_result(directory)
            write_report(report)
            contact_path = source / 'output/ottoman-sit-candidate-02/strict-contact-proof-02.json'
            original_contact = contact_path.read_bytes()
            contact = json.loads(original_contact)
            contact['samples'] = contact['samples'][:3]
            contact_path.write_text(json.dumps(contact))
            contact_name = 'output/ottoman-sit-candidate-02/strict-contact-proof-02.json'
            resigned = {**report, 'outputs': {**report['outputs'], contact_name:
                hashlib.sha256(contact_path.read_bytes()).hexdigest()}}
            write_report(resigned)
            with self.assertRaisesRegex(ValueError, 'accepted contact samples', msg='contact samples'):
                inspect_result(directory)
            contact_path.write_bytes(original_contact)
            write_report(report)
            (source / 'model.blend').write_bytes(b'changed model')
            with self.assertRaisesRegex(ValueError, 'input hash', msg='input hash'):
                inspect_result(directory)

    def test_resigned_requests_cannot_omit_inputs_or_repeat_one_regression_case(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'fresh'
            request = prepare_job(directory)
            bundle = load_bundle(CATALOG, root=ROOT)
            outputs = {}
            for name in OUTPUTS:
                target = directory / 'source' / name
                shutil.copyfile(bundle.resolve(name), target)
                outputs[name] = digest(target)
            report = {'state': 'complete', 'job_id': request['job_id'], 'pid': 123,
                'request_sha256': digest(directory / 'request.json'),
                'engine': ['4.5.14 LTS', '62c1db4208e8'], 'background': True,
                'source_bytes_unchanged': True,
                'resources': [{'model': name, 'required_external_paths': []}
                    for name in request['inputs'] if name.endswith('.blend')],
                'outputs': outputs}
            def write_evidence(new_request, new_report):
                (directory / 'request.json').write_text(json.dumps(new_request))
                new_report['request_sha256'] = digest(directory / 'request.json')
                (directory / 'result.json').write_text(json.dumps(new_report))
            write_evidence(request, report)
            self.assertEqual(collect_result(directory)['models_audited'], 4)
            changed_request = {**request, 'bundle_sha256': '0'*64}
            write_evidence(changed_request, copy.deepcopy(report))
            with self.assertRaisesRegex(ValueError, 'bundle changed', msg='pinned bundle hash'):
                collect_result(directory)
            omitted = 'assets/models/living/owner-review-pending/ottoman/candidate-01/ottoman-authoring.blend'
            changed_request, changed_report = copy.deepcopy(request), copy.deepcopy(report)
            del changed_request['inputs'][omitted]
            changed_report['resources'] = [row for row in changed_report['resources'] if row['model'] != omitted]
            write_evidence(changed_request, changed_report)
            with self.assertRaisesRegex(ValueError, 'pinned contact-stage inventory', msg='pinned input inventory'):
                collect_result(directory)
            write_evidence(request, report)
            contact_path = directory / 'source' / OUTPUTS[0]
            original_contact = contact_path.read_bytes()
            contact = json.loads(original_contact)
            contact['samples'][0]['maximum_bone_length_error'] = 99
            contact_path.write_text(json.dumps(contact))
            changed_report = copy.deepcopy(report)
            changed_report['outputs'][OUTPUTS[0]] = digest(contact_path)
            write_evidence(request, changed_report)
            with self.assertRaisesRegex(ValueError, 'contact measurements differ', msg='equal contact measurements'):
                collect_result(directory)
            contact_path.write_bytes(original_contact)
            regression_path = directory / 'source' / OUTPUTS[1]
            regression = json.loads(regression_path.read_text())
            regression['cases'] = [regression['cases'][0]] * 7
            regression_path.write_text(json.dumps(regression))
            changed_report = copy.deepcopy(report)
            changed_report['outputs'][OUTPUTS[1]] = digest(regression_path)
            write_evidence(request, changed_report)
            with self.assertRaisesRegex(ValueError, 'occupancy cases differ', msg='distinct occupancy cases'):
                collect_result(directory)


if __name__ == '__main__':
    unittest.main()
