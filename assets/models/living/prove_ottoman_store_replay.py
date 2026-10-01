"""Remove completion guards in memory and require their specific assertions."""
import argparse
import io
import json
from pathlib import Path
import types
import unittest

from ottoman_bundle import digest
import test_ottoman_store_replay as tests

BASE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    paths = [BASE / name for name in ('ottoman_store_replay.py', 'ottoman_blender_job.py',
        'test_ottoman_store_replay.py', 'ottoman_replay.py', 'prove_ottoman_store_replay.py')]
    before = {path.name: digest(path) for path in paths}
    source = paths[0].read_text(encoding='utf-8')
    complete = 'test_completion_requires_engine_resources_outputs_and_unchanged_copies'
    resigned = 'test_resigned_requests_cannot_omit_inputs_or_repeat_one_regression_case'
    cases = [
        ("if report.get('job_id') != request['job_id']:", 'if False:',
         'test_a_launcher_return_without_a_blender_receipt_is_not_completion', 'job identity'),
        ("if report.get('request_sha256') != digest(directory / 'request.json'):", 'if False:', complete, 'request hash'),
        ("if report.get('engine') != ENGINE:", 'if False:', complete, 'engine'),
        ("if report.get('background') is not True:", 'if False:', complete, 'background'),
        ("if report.get('source_bytes_unchanged') is not True:", 'if False:', complete, 'source bytes'),
        ("or digest(path) != expected", '', complete, 'input hash'),
        ("if not models or sorted(row['model'] for row in resources) != models:", 'if False:', complete, 'resource inventory'),
        ("if any(row.get('required_external_paths') != [] for row in resources):", 'if False:', complete, 'external resources'),
        ("if set(report.get('outputs', {})) != set(OUTPUTS):", 'if False:', complete, 'output inventory'),
        ("or [row.get('frame') for row in outputs[0].get('samples', [])] != [1, 2, 3, 4]", '', complete, 'contact samples'),
        ("if digest(catalog) != request['bundle_sha256']:", 'if False:', resigned, 'pinned bundle hash'),
        ("if request['inputs'] != expected_inputs:", 'if False:', resigned, 'pinned input inventory'),
        ("if actual['samples'] != accepted['samples']:", 'if False:', resigned, 'equal contact measurements'),
        ("if actual_cases != accepted_cases:", 'if False:', resigned, 'distinct occupancy cases'),
    ]
    originals = {name: getattr(tests, name) for name in ('inspect_result', 'collect_result')}
    rows = []
    try:
        for old, new, name, marker in cases:
            if source.count(old) != 1:
                raise ValueError(f'Ambiguous mutation: {marker}')
            module = types.ModuleType('mutated_store_replay')
            module.__file__ = str(paths[0])
            exec(compile(source.replace(old, new), str(paths[0]), 'exec'), module.__dict__)
            for function in originals:
                setattr(tests, function, getattr(module, function))
            output = io.StringIO()
            result = unittest.TextTestRunner(stream=output).run(tests.OttomanStoreReplayTests(name))
            if (result.testsRun != 1 or not result.failures or result.errors or result.skipped
                    or not any('AssertionError' in failure and marker in failure
                               for _, failure in result.failures)):
                raise AssertionError(f'Guard did not fail its named assertion: {marker}\n{output.getvalue()}')
            rows.append({'guard': marker, 'test': name, 'output': output.getvalue()})
    finally:
        for function, original in originals.items():
            setattr(tests, function, original)
        if before != {path.name: digest(path) for path in paths}:
            raise AssertionError('Source changed during completion-guard proof')
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(tests.OttomanStoreReplayTests))
    if not result.wasSuccessful() or result.testsRun != 3 or result.skipped:
        raise AssertionError(output.getvalue())
    report = {'state': 'complete', 'inputs': before, 'mutations': rows,
        'restored_tests': result.testsRun, 'restored_output': output.getvalue(),
        'source_bytes_unchanged': True}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    print(f'PASS: {len(rows)} completion guards detected; 3 restored tests pass')


if __name__ == '__main__':
    main()
