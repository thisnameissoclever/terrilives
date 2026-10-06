"""Recover completed cached geometry controls without rerunning their work."""
import hashlib
import json
from pathlib import Path
import sys


def run(source,output):
    output.mkdir(parents=True,exist_ok=False);path=source/'proof.json';prior=json.loads(path.read_text())
    if len(prior['cases'])!=2:raise ValueError('Both complete cached evaluations must exist')
    cases=prior['cases'];rows=cases[1]['rows']
    checks=dict(
        right_forearm=any(r['kind']=='arm_body' and r.get('parts')==['Forearm with elbow and wrist sections.001','Overshirt body'] and not r['valid'] for r in rows),
        right_cuff=any(r['kind']=='arm_body' and r.get('parts')==['Turned sleeve cuff.001','Overshirt body'] and not r['valid'] for r in rows),
        head_collar_containment=any(r['kind']=='body_containment' and set(r['parts'])=={'Folded fabric collar leaf','Sculpted head'} and not r['valid'] for r in rows),
        bilateral_finite_support=len([r for r in rows if r['kind']=='support' and r['valid']])==2,
        valid_wrist_joins=len([r for r in rows if r['kind']=='arm_body' and 'wrist' in r and r['valid']])==4,
        legitimate_source_collar_joins=len([r for r in cases[0]['rows'] if r['kind']=='neck_collar_attachment' and r['valid']])==3,
        construction_uses_complete_gate=prior['construction_rejected_known_bad_pose'],
        complete_coverage=all(all(c['coverage'].values()) for c in cases),
        conjunctive_replay_gate=all(c['feasible']==(not any(not r['valid'] for r in c['rows'])) for c in cases))
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs=dict(prior['inputs']);inputs[str(path.resolve())]=digest(path);inputs[str(Path(__file__).resolve())]=digest(Path(__file__))
    for c in cases:
        p=source/c['cache']['path']
        if digest(p)!=c['cache']['sha256']:raise ValueError('Cached control witness changed')
        inputs[str(p.resolve())]=c['cache']['sha256']
    if not all(digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('Cached control input changed')
    report=dict(state='complete',inputs=inputs,passed=all(checks.values()),controls=checks,
        source_run_state=prior['state'],source_run_error=prior.get('error'),
        recovery='Both complete evaluations and indexed arrays were written before a final formatter assumed every parts field contained strings. This reads those outputs; no geometry is rerun.',
        cases=[dict(label=c['label'],seconds=c['seconds'],feasible=c['feasible'],failures=len(c['failures']),kernel_candidates=c['kernel_candidates']) for c in cases],
        reference_parameter_reconstruction_error=prior['reference_parameter_reconstruction_error'])
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='inputs'},indent=2))
    if not report['passed']:raise ValueError('A recovered cached geometry control failed')


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
