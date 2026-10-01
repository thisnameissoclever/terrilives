"""Delete archive guards in memory and require their named tests to fail."""
import hashlib
import io
import json
from pathlib import Path
import types
import unittest
import argparse

import test_ottoman_bundle as tests
import test_ottoman_replay as replay_tests

BASE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    paths = [BASE / 'ottoman_bundle.py', BASE / 'test_ottoman_bundle.py', Path(__file__),
             BASE / 'ottoman_replay.py', BASE / 'test_ottoman_replay.py']
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    before = {p.name: digest(p) for p in paths}
    source = paths[0].read_text(encoding='utf-8')
    cases = [
        ('file_hash', "if digest(path) != row['sha256']:", 'if False:',
         'test_changed_archived_bytes_are_rejected_even_when_original_output_exists'),
        ('receipt_binding', "if expected_sha is not None and expected_sha != row['sha256']:", 'if False:',
         'test_receipt_hash_must_agree_with_mapping_hash'),
        ('historical_alias', 'if name.casefold() in names:', 'if False:',
         'test_path_aliases_cannot_hide_duplicate_inputs'),
        ('target_alias', 'if target.casefold() in targets:', 'if False:',
         'test_case_only_target_alias_is_rejected'),
        ('resolved_containment', "if not path.is_relative_to(self.root / 'assets'):", 'if False:',
         'test_resolved_archive_cannot_escape_through_a_link'),
        ('device_name', "raise ValueError(f'Reserved device in ottoman bundle path: {value!r}')", 'pass',
         'test_paths_cannot_escape_alias_or_target_temporary_sources'),
        ('fresh_destination', 'destination.mkdir(parents=True, exist_ok=False)',
         'destination.mkdir(parents=True, exist_ok=True)',
         'test_replay_uses_independent_copies_and_never_overwrites_a_destination'),
        ('copy_isolation', 'shutil.copyfile(source, target)', 'target.hardlink_to(source)',
         'test_replay_uses_independent_copies_and_never_overwrites_a_destination'),
    ]
    original, rows = tests.load_bundle, []
    try:
        for guard, old, new, name in cases:
            if source.count(old) != 1:
                raise ValueError(f'Ambiguous guard mutation: {guard}')
            module = types.ModuleType('mutated_ottoman_bundle')
            exec(compile(source.replace(old, new), f'<removed-{guard}>', 'exec'), module.__dict__)
            tests.load_bundle = module.load_bundle
            capture = io.StringIO()
            result = unittest.TextTestRunner(stream=capture).run(tests.OttomanBundleTests(name))
            if (result.testsRun != 1 or not result.failures or result.errors or result.skipped
                    or any('AssertionError' not in failure for _, failure in result.failures)):
                raise AssertionError(f'Guard did not fail its assertion: {guard}\n{capture.getvalue()}')
            rows.append({'guard': guard, 'test': name, 'output': capture.getvalue()})
    finally:
        tests.load_bundle = original
        if before != {p.name: digest(p) for p in paths}:
            raise AssertionError('Source bytes changed during in-memory guard proof')
    capture = io.StringIO()
    result = unittest.TextTestRunner(stream=capture).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(tests.OttomanBundleTests))
    if not result.wasSuccessful() or result.testsRun != 14 or result.skipped:
        raise AssertionError(capture.getvalue())
    restored_loader_output = capture.getvalue()
    replay_source = paths[3].read_text(encoding='utf-8')
    replay_cases = [
        ('stage_isolation', 'return sorted(names)',
         'return sorted(bundle.records)',
         'test_each_stage_seeds_inputs_but_not_its_outputs'),
        ('original_source_recheck', 'bundle.resolve(name)', 'pass',
         'test_changed_source_and_resigned_catalog_leave_a_failed_journal'),
        ('absolute_executable', 'executable = Path(executable).resolve()', 'executable = Path(executable)',
         'test_blender_probe_and_recipe_use_the_same_absolute_executable'),
    ]
    originals = {name: getattr(replay_tests, name) for name in ('prepare_stage', 'run_commands', 'blender_command')}
    try:
        for guard, old, new, name in replay_cases:
            if replay_source.count(old) != 1:
                raise ValueError(f'Ambiguous replay mutation: {guard}')
            module = types.ModuleType('mutated_ottoman_replay')
            module.__file__ = str(paths[3])
            exec(compile(replay_source.replace(old, new), f'<removed-{guard}>', 'exec'), module.__dict__)
            for function in originals:
                setattr(replay_tests, function, getattr(module, function))
            capture = io.StringIO()
            result = unittest.TextTestRunner(stream=capture).run(replay_tests.OttomanReplayTests(name))
            if (result.testsRun != 1 or not result.failures or result.errors or result.skipped
                    or any('AssertionError' not in failure for _, failure in result.failures)):
                raise AssertionError(f'Replay guard did not fail its assertion: {guard}\n{capture.getvalue()}')
            rows.append({'guard': guard, 'test': name, 'output': capture.getvalue()})
    finally:
        for function, original in originals.items():
            setattr(replay_tests, function, original)
        if before != {p.name: digest(p) for p in paths}:
            raise AssertionError('Source bytes changed during in-memory replay proof')
    capture = io.StringIO()
    result = unittest.TextTestRunner(stream=capture).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(replay_tests.OttomanReplayTests))
    if not result.wasSuccessful() or result.testsRun != 3 or result.skipped:
        raise AssertionError(capture.getvalue())
    report = {'state': 'complete', 'inputs': before, 'mutations': rows,
              'restored_output': restored_loader_output + capture.getvalue(), 'source_bytes_unchanged': True}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    print('PASS: 11 removed guards fail named assertions; 17 restored tests pass; source bytes unchanged')


if __name__ == '__main__':
    main()
