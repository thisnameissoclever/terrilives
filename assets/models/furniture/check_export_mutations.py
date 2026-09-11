"""Exercise export/contact guards through mutations without touching source files."""
import io
from pathlib import Path
import types
import unittest

import test_contact_contract
import test_contribution_export
import test_layer_partition

BASE = Path(__file__).resolve().parent


def run():
    jobs = [
        ('export_contributions.py','def validate_ownership(palettes):',
         'def validate_ownership(palettes):\n    return',test_contribution_export,'validate_ownership',
         'ContributionExportTests','test_shirt_changes_belong_to_body_not_furniture'),
        ('export_contributions.py',"if hashlib.sha256(path.read_bytes()).hexdigest() != expected:",
         'if False:',test_contribution_export,'validate_signature',
         'ContributionExportTests','test_signature_rejects_changed_sources_and_missing_scripts'),
        ('contact_contract.py',"if support is None or not math.isfinite(support) or abs(support) > 1e-5:",
         'if False:',test_contact_contract,'validate_contact_report',
         'ContactContractTests','test_height_alone_cannot_prove_horizontal_support'),
        ('contact_contract.py',"if report.get('obstacle_count') != 6 or report.get('shoe_count') != 4:",
         'if False:',test_contact_contract,'validate_contact_report',
         'ContactContractTests','test_empty_obstacle_inventory_cannot_pass'),
        ('layer_partition.py','if outline is None:','if True:',test_layer_partition,'reconstruct_layers',
         'LayerPartitionTests','test_shared_outline_is_overlaid_once_after_base_addition'),
    ]
    for filename,old,new,test_module,binding,case,name in jobs:
        path = BASE/filename
        before = path.read_bytes()
        source = before.decode()
        assert source.count(old) == 1
        mutant = types.ModuleType('mutant')
        mutant.__file__ = str(path)
        exec(compile(source.replace(old,new),str(path),'exec'),mutant.__dict__)
        original = getattr(test_module,binding)
        try:
            setattr(test_module,binding,getattr(mutant,binding))
            capture = io.StringIO()
            test = getattr(test_module,case)(name)
            result = unittest.TextTestRunner(stream=capture).run(unittest.TestSuite([test]))
            print(f'MUTATION {filename}: {name}\n{capture.getvalue()}')
            assert len(result.failures) == 1 and not result.errors, 'Mutation escaped or failed for the wrong reason'
        finally:
            setattr(test_module,binding,original)
        assert path.read_bytes() == before
        result = unittest.TextTestRunner().run(unittest.TestSuite([getattr(test_module,case)(name)]))
        assert result.wasSuccessful()
        print('PASS: detected, binding restored, source bytes unchanged, original test passes')


if __name__ == '__main__':
    run()
