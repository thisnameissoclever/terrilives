"""Require deliberate importer defects to fail named tests without editing sources."""
import argparse
from contextlib import ExitStack
import hashlib
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import offline_ottoman
import ottoman_originals
import test_offline_ottoman as importer_tests
import test_ottoman_receipt as receipt_tests

BASE = Path(__file__).resolve().parent


def replace_function(source, function, old, new):
    start = source.index(f'def {function}(')
    end = source.find('\ndef ', start + 1)
    if end < 0:
        end = len(source)
    body = source[start:end]
    if body.count(old) != 1:
        raise ValueError(f'Ambiguous mutation in {function}: {old}')
    return source[:start] + body.replace(old, new) + source[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    sources = {name: BASE / (name + '.py') for name in
               ('ottoman_receipt', 'offline_seating', 'offline_ottoman', 'ottoman_originals',
                'test_ottoman_receipt', 'test_offline_ottoman', 'prove_ottoman_receipt')}
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    before = {name: digest(path) for name, path in sources.items()}
    cases = [
        ('null_digest', 'load_receipt',
         "if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):", 'if False:',
         'test_null_dependency_digest_cannot_disable_receipt_binding'),
        ('contact_acceptance', 'validate_contact', "contact.get('accepted') is not True", 'False',
         'test_resigned_unaccepted_contact_report_is_rejected'),
        ('contact_coverage', 'load_receipt', "validate_contact(values['contact'])", 'pass',
         'test_resigned_missing_contact_frame_is_rejected'),
        ('self_collision', 'validate_contact', "or row.get('body_self_intersections') != []", '',
         'test_resigned_body_penetration_is_rejected'),
        ('hip_area', 'support_bounds', 'or area < .0024', '',
         'test_resigned_unsupported_hip_is_rejected'),
        ('hip_gap', 'validate_contact', 'or not 0 <= gap <= .003', '',
         'test_resigned_hip_gap_is_checked_independently_of_support_area'),
        ('floor_gap', 'validate_contact', 'or not 0 <= bounds[0][2] <= .001', '',
         'test_resigned_foot_above_floor_is_rejected'),
        ('bone_length', 'validate_contact', 'or not 0 <= error < 1e-5', '',
         'test_resigned_stretched_bone_is_rejected'),
        ('raw_coverage', 'validate_raw', 'if found != expected:', 'if False:',
         'test_resigned_missing_render_cannot_claim_complete_coverage'),
        ('raw_path', 'validate_raw', "if row.get('path') != filename or filename in paths:", 'if False:',
         'test_resigned_raw_path_must_name_its_actual_sample'),
        ('raw_frame_type', 'validate_raw', 'type(key[1]) is not int or ', '',
         'test_resigned_boolean_frame_is_not_integer_one'),
        ('palette_contact', 'load_receipt', "validate_raw(values['raw_proof'], values['contact'].get('samples'))", 'pass',
         'test_resigned_palette_contacts_must_match_the_strict_source_check'),
        ('max_error', 'validate_comparison', "row['max_error'] > 64", 'False',
         'test_resigned_failed_reconstruction_cannot_enter_the_atlas'),
        ('p95_error', 'validate_comparison', "or row['p95_error'] > 12", '',
         'test_resigned_p95_reconstruction_error_cannot_exceed_its_own_limit'),
        ('comparison_coverage', 'validate_comparison', 'if found != expected:', 'if False:',
         'test_resigned_reconstruction_must_cover_every_sample'),
        ('comparison_duplicate', 'validate_comparison', 'or key in found', '',
         'test_resigned_duplicate_reconstruction_is_not_a_second_sample'),
        ('cross_bindings', 'validate_bindings', 'bundle.resolve(name, sha)', 'pass',
         'test_resigned_receipts_cannot_bind_unrelated_models_or_exports'),
        ('preview_cadence', 'validate_cadence', "or preview.get('frame_durations_ms') != [500, 500, 500, 500]", '',
         'test_resigned_preview_must_use_the_saved_action_cadence'),
        ('occupancy_coverage', 'load_receipt', "validate_occupancy(values['occupancy'])", 'pass',
         'test_resigned_missing_occupancy_regression_cannot_claim_acceptance'),
        ('mapped_images', 'validate_bindings', "bundle.resolve(BASE + 'offline-export/' + name, ref['sha256'])", 'pass',
         'test_unmapped_layer_is_rejected_even_when_its_file_is_available'),
        ('original_evidence_binding', 'receipt_session',
         "if (digest(catalog_path) != bindings['catalog_sha256']\n            or digest(bundle_path) != bindings['bundle_sha256']):", 'if False:',
         'test_verification_session_rejects_a_replaced_but_valid_evidence_bundle'),
    ]
    for label, old in [('state', "report.get('state') != 'complete'"),
                       ('fit', "report.get('fit_passed') is not True"),
                       ('unchanged', "report.get('source_bytes_unchanged') is not True"),
                       ('blender', "report.get('blender_version') != '4.5.14 LTS'"),
                       ('fingerprint', "report.get('preserved_scene_fingerprint') !=\n               '34ed46973fe5b6d09469fb2a26a49eb72d1a77b15abb023000a43cc38f07e181'")]:
        cases.append((f'authoring_{label}', 'validate_authoring', old, 'False',
                      'test_reviewed_loader_rejects_an_unfinished_source_before_importing_sprites'))
    all_cases = [('ottoman_receipt', *case) for case in cases]
    all_cases += [
        ('offline_seating', 'existing_empties', 'load_seating',
         'if reuse_empty and not {empty_name(prefix, f) for f in FACINGS}.issubset(names):', 'if False:',
         'test_reused_empty_requires_every_published_facing'),
        ('ottoman_originals', 'original_dimensions', 'verify_pixels',
         "or image.size != (768, 960)", '',
         'test_full_verification_rejects_a_resigned_wrong_size_original'),
    ]
    rows = []
    try:
        for name, label, function, old, new, test_name in all_cases:
            source = sources[name].read_text(encoding='utf-8')
            module = types.ModuleType(f'mutated_{name}')
            module.__file__ = str(sources[name])
            exec(compile(replace_function(source, function, old, new), f'<removed-{label}>', 'exec'), module.__dict__)
            capture = io.StringIO()
            with ExitStack() as stack:
                test_class = receipt_tests.OttomanReceiptTests
                if name == 'ottoman_receipt':
                    for target in (receipt_tests, offline_ottoman):
                        stack.enter_context(patch.object(target, 'load_receipt', module.load_receipt))
                    for target in (receipt_tests, ottoman_originals):
                        stack.enter_context(patch.object(target, 'receipt_session', module.receipt_session))
                elif name == 'offline_seating':
                    stack.enter_context(patch.object(offline_ottoman, 'load_seating', module.load_seating))
                    test_class = importer_tests.OttomanImportTests
                else:
                    stack.enter_context(patch.object(receipt_tests, 'verify_originals', module.verify_originals))
                result = unittest.TextTestRunner(stream=capture).run(test_class(test_name))
            if (result.testsRun != 1 or not result.failures or result.errors or result.skipped
                    or any('AssertionError' not in failure for _, failure in result.failures)):
                raise AssertionError(f'Mutation did not fail its named assertion: {label}\n{capture.getvalue()}')
            rows.append({'guard': label, 'test': test_name, 'output': capture.getvalue()})
    finally:
        if before != {name: digest(path) for name, path in sources.items()}:
            raise AssertionError('Source bytes changed during in-memory receipt proof')
    capture = io.StringIO()
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in
                               (receipt_tests.OttomanReceiptTests, importer_tests.OttomanImportTests))
    result = unittest.TextTestRunner(stream=capture).run(suite)
    if not result.wasSuccessful() or result.testsRun != 32 or result.skipped:
        raise AssertionError(capture.getvalue())
    report = {'state': 'complete', 'inputs': before, 'mutations': rows,
              'restored_output': capture.getvalue(), 'source_bytes_unchanged': True}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    print(f'PASS: {len(rows)} deliberate defects fail named assertions; 32 restored tests pass; source bytes unchanged')


if __name__ == '__main__':
    main()
