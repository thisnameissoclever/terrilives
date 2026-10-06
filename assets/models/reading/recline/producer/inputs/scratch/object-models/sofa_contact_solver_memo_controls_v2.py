"""Exact cache hits, witness relocation and geometry invalidation controls."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from sofa_contact_solver_memo import ExactGeometryMemo,geometry_key

root=Path(__file__).parent
out=root/'sofa-contact-solver-memo-controls-02'
out.mkdir(exist_ok=False)
memo=ExactGeometryMemo();calls=[]
surface=SimpleNamespace(points=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]]),triangles=np.array([[0,1,2]]))
def calculate(arrays,prefix):
    calls.append(1);arrays[prefix+'/pairs']=np.array([[1,2]],dtype=np.int32)
    return dict(valid=False,witness_array=prefix+'/pairs',witness=prefix,residual=3.25)
arrays={}
first=memo.query('pair',(geometry_key(surface),),calculate,arrays,'first')
second=memo.query('pair',(geometry_key(surface),),calculate,arrays,'second')
assert len(calls)==1 and second['witness_array']=='second/pairs' and np.array_equal(arrays['first/pairs'],arrays['second/pairs'])
surface.points[0,0]=np.nextafter(0.,1.)
third=memo.query('pair',(geometry_key(surface),),calculate,arrays,'third')
assert len(calls)==2
surface.triangles[0]=[0,2,1]
fourth=memo.query('pair',(geometry_key(surface),),calculate,arrays,'fourth')
assert len(calls)==3
assert all(row['residual']==3.25 and not row['valid'] for row in (first,second,third,fourth))
memo.query('context-pair',('source-a','owner-a',geometry_key(surface)),calculate,arrays,'context1')
memo.query('context-pair',('source-a','owner-a',geometry_key(surface)),calculate,arrays,'context2')
assert len(calls)==4
memo.query('context-pair',('source-b','owner-a',geometry_key(surface)),calculate,arrays,'context3')
assert len(calls)==5
memo.query('context-pair',('source-b','owner-b',geometry_key(surface)),calculate,arrays,'context4')
assert len(calls)==6
paths=[Path(__file__),root/'sofa_contact_solver_memo.py']
proof=dict(state='complete',passed=True,controls=['Exact unchanged geometry reuses a result','Smallest representable coordinate change invalidates it','Ordered triangle winding change invalidates it','Witness arrays relocate without dropping failure residuals','Changed source identity invalidates a result','Changed ownership identity invalidates a result'],hits=memo.hits,misses=memo.misses,inputs={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
