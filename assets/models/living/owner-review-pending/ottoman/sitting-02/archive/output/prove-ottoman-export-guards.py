"""Delete individual export guards in memory and require their tests to fail."""
import hashlib
import importlib.util
import inspect
import io
import json
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parent
FILES = [BASE/'export-ottoman-sit-review.py', BASE/'test_ottoman_export_review.py', Path(__file__)]
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
before = {path.name: digest(path) for path in FILES}
spec = importlib.util.spec_from_file_location('coverage_tests', FILES[1])
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
original = tests.review.validate_rows
source = inspect.getsource(original)
cases = [
    ('complete_state', "proof.get('state') != 'complete'", 'False', 'test_incomplete_state'),
    ('sample_coverage', 'if keys != expected:', 'if False:', 'test_missing_frame'),
    ('duplicate_identity', ' or key in keys', '', 'test_duplicate_sample'),
    ('sample_path', "if row['path'] != filename or row['path'] in paths:", 'if False:', 'test_path_escape'),
    ('registration', "raise ValueError('Camera registration changed')", 'pass', 'test_registration_drift'),
    ('palette_contact', "raise ValueError('Palette contact samples are missing or different')", 'pass', 'test_colour_contact_drift'),
]
rows = []
try:
    for name, old, new, test in cases:
        assert source.count(old) == 1, f'Mutation target is ambiguous: {name}'
        namespace = dict(vars(tests.review))
        changed = source.replace(old, new)
        if name == 'duplicate_identity':
            # Either key or path duplication is sufficient to reject this fixture.
            # Delete both parts of duplicate identity, not the filename binding.
            changed = changed.replace(" or row['path'] in paths", '')
        exec(compile(changed, f'<removed-{name}>', 'exec'), namespace)
        tests.review.validate_rows = namespace['validate_rows']
        capture = io.StringIO()
        result = unittest.TextTestRunner(stream=capture).run(tests.RenderCoverageTests(test))
        assert result.testsRun == 1 and len(result.failures) == 1 and not result.errors, name+'\n'+capture.getvalue()
        assert 'ValueError not raised' in result.failures[0][1], capture.getvalue()
        rows.append({'guard': name, 'test': test, 'killed': True, 'output': capture.getvalue()})
finally:
    tests.review.validate_rows = original
capture = io.StringIO()
clean = unittest.TextTestRunner(stream=capture).run(unittest.defaultTestLoader.loadTestsFromTestCase(tests.RenderCoverageTests))
assert clean.wasSuccessful() and clean.testsRun == 8, capture.getvalue()
assert before == {path.name: digest(path) for path in FILES}
proof = {'state': 'complete', 'inputs': before, 'mutations': rows,
         'restored_output': capture.getvalue(), 'source_bytes_unchanged': True,
         'earlier_survivor': 'Removing only duplicate-key rejection left the test passing because duplicate-path rejection still caught it. The duplicate-identity probe removes both checks together.'}
(BASE/'ottoman-sit-candidate-02/offline-export/guard-deletion-proof.json').write_text(
    json.dumps(proof, indent=2)+'\n')
print('PASS: six guard-deletion cases fail their named tests; all eight pass after restoration; source bytes unchanged.')
