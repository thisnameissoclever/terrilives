"""Remove import guards, require the regression test to fail, restore exact bytes."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
IMPORTER=ROOT/'assets/sprites/gen/offline_architecture.py'
SCENE=ROOT/'assets/models/architecture/check_scene.py'
MATERIALS=ROOT/'assets/models/architecture/materials.py'
RUNNER="""import json,sys,unittest
suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1])
result=unittest.TestResult()
suite.run(result)
print(json.dumps({'testsRun':result.testsRun,'failures':[{'test':test.id(),'traceback':trace} for test,trace in result.failures], 'errors':[{'test':test.id(),'traceback':trace} for test,trace in result.errors]}))
sys.exit(0 if result.wasSuccessful() else 1)
"""


def remove_asserts(text,message):
    """Delete only assertions, preserving initialization and surrounding control flow."""
    nodes=[node for node in ast.walk(ast.parse(text)) if isinstance(node,ast.Assert)
           and isinstance(node.msg,ast.Constant) and node.msg.value==message]
    assert nodes, 'mutation did not find its guard'
    lines=text.splitlines(keepends=True)
    for node in sorted(nodes,key=lambda n:n.lineno,reverse=True):
        line=lines[node.lineno-1]
        newline='\r\n' if line.endswith('\r\n') else '\n'
        lines[node.lineno-1:node.end_lineno]=[' '*node.col_offset+'pass'+newline]
    return ''.join(lines)


def probe(test,cwd):
    command=[sys.executable,'-B','-c',RUNNER,test]
    result=subprocess.run(command,cwd=cwd,capture_output=True,text=True)
    assert not result.stderr, result.stderr
    parsed=json.loads(result.stdout)
    assert parsed['testsRun']==1 and not parsed['errors'], 'probe did not reach one valid test: '+result.stdout
    return {'command':command,'cwd':str(cwd),'exitCode':result.returncode,
            'output':result.stdout,'result':parsed}


def run(destination):
    evidence=[]
    importer='test_offline_architecture.ArchitectureImport.'
    geometry='test_catalogue.FullArchitectureGeometry.'
    changes=[('missing model',IMPORTER,'missing window model',importer+'test_missing_model_rejected'),
             ('width',IMPORTER,'window width changed',importer+'test_changed_width_rejected'),
             ('direction',IMPORTER,'window direction changed',importer+'test_changed_direction_rejected'),
             ('depth registration',IMPORTER,'depth registration changed',importer+'test_shifted_depth_rejected'),
             ('sill contact',SCENE,'detached sill',importer+'test_detached_sill_rejected'),
             ('split ownership',IMPORTER,'overlapping split ownership',importer+'test_overlapping_split_ownership_rejected'),
             ('bar contact',SCENE,'bar outside authored frame joints',geometry+'test_every_authored_bar_rejects_displacement_outside_frame_joints'),
             ('resource reference',MATERIALS,'unknown pattern resource',importer+'test_pattern_resource_reference_rejected'),
             ('shipped resource',MATERIALS,'pattern resource is not shipped',importer+'test_unshipped_pattern_resource_rejected'),
             ('glazing ownership',MATERIALS,None,geometry+'test_production_surface_roles_keep_glazing_frame_and_trim_independent'),
             ('excluded carrier',MATERIALS,None,geometry+'test_production_carrier_selection_preserves_independent_materials')]
    for name,path,message,target in changes:
        before=path.read_bytes(); text=before.decode()
        if message:
            changed=remove_asserts(text,message)
        elif name=='glazing ownership':
            changed=text.replace("'glass': 'glazing'","'glass': 'wall'")
        else:
            changed=text.replace("if material_role(material_key) in (1,2) else material_key",
                                 "if material_key == 'glass' or material_role(material_key) in (1,2) else material_key")
        assert changed!=text, 'mutation did not remove a guard'
        cwd=IMPORTER.parent if target.startswith('test_offline') else SCENE.parent
        control=(importer+'test_manifest_clean_control' if cwd==IMPORTER.parent else
                 geometry+'test_nine_models_and_all_physical_views')
        baseline=probe(target,cwd)
        assert baseline['exitCode']==0, 'regression test failed before mutation'
        try:
            path.write_bytes(changed.encode())
            clean=probe(control,cwd)
            assert clean['exitCode']==0, f'mutation broke clean input: {name}'
            failed=probe(target,cwd)
            assert failed['exitCode']==1, f'guard deletion survived: {name}'
            failures=failed['result']['failures']
            assert failures and all(row['test']==target or row['test'].startswith(target+' (') for row in failures), 'unexpected test failed'
            if target.startswith(importer):
                assert all('intended malformed case' in row['traceback'] for row in failures), 'failure did not reach the intended malformed case'
            evidence.append({'mutation':name,'removedGuard':message,'baseline':baseline,
                             'mutatedCleanControl':clean,'targetedFailure':failed})
        finally:
            path.write_bytes(before)
            assert path.read_bytes()==before, 'mutation restoration changed source'
        evidence[-1]['restoredSha256']=hashlib.sha256(before).hexdigest()
        restored=probe(target,cwd)
        assert restored['exitCode']==0, 'restored regression test failed'
        evidence[-1]['restoredTarget']=restored
    destination.write_text(json.dumps({'mutations':evidence},indent=2)+'\n')
    print(f'{len(evidence)} targeted mutations detected; every mutated clean control passed; exact source restored; every restored target passed')


if __name__=='__main__': run(Path(sys.argv[1]))
