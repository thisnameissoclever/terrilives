"""Complete resting-arm gate shared by regression controls and candidate selection.

The source shoulder rule is deliberately conservative: one closed boundary,
proximal-cap connection, no distal-cap connection, and no material below the
neutral seam envelope. None of those conditions alone permits an attachment.
"""
from pathlib import Path
import json
import numpy as np

import sofa_coupled_contact_evaluator as source_eval
import sofa_coupled_contact_evaluator_v2 as material
from sofa_coupled_contact_segments import mapped_segments
from classify_sofa_lap_contacts import functions_from, source_map, projected_all
import continuous_support_patch as patch

ARM_PARTS = ('Relaxed shirt sleeve', 'Turned sleeve cuff',
             'Forearm with elbow and wrist sections', 'Relaxed palm', 'Resting thumb')
REQUIRED = ('arm_body', 'folds', 'furniture', 'neighbors', 'support', 'joints', 'fixed_body')


def gate(rows, coverage):
    """Selection and final acceptance use the exact same named residuals."""
    failures = [row for row in rows if not row['valid']]
    failures += [dict(kind='missing coverage', name=name, valid=False)
                 for name in REQUIRED if coverage.get(name) is not True]
    return dict(valid=not failures, failures=failures,
                merit=sum(float(row.get('residual', 1.)) for row in failures), coverage=coverage)


class Evaluator:
    def __init__(self, root):
        self.root = Path(root)
        self.rest = np.load(self.root/'sofa-derived-binding-03/normalized-rest.npz')
        self.topology = np.load(self.root/'sofa-binding-audit-01/source-binding.npz')
        self.audit = json.loads((self.root/'sofa-binding-audit-01/proof.json').read_text())
        self.neutral = json.loads((self.root/'sofa-coupled-contact-neutral-shoulders-01/proof.json').read_text())
        self.source = {}
        self.groups = {name: row['groups'] for name, row in self.audit['saved_objects'].items()}
        self.primitives = functions_from(self.root/'audit_sofa_binding.py')

    def classify(self, first, second, world, local, faces, prior=None):
        if prior is None:
            for name in (first, second):
                if name not in self.source:
                    self.source[name] = source_eval.SourceSurface(self.rest[name+'/rest_points'], self.rest[name+'/triangles'])
            prior = source_eval.classify_segments(first, second, local, self.source, self.groups)
        result, components = material.classify_case(first, second, world, local, faces,
                                                  prior, self.topology, self.audit)
        if first.removesuffix('.001') == 'Relaxed shirt sleeve' and second == 'Overshirt body':
            caps = material.closures(first, self.topology)
            neutral = next(row for row in self.neutral['cases'] if row['name'] == first)
            components = material.component_ids(world)
            floor = neutral['bounds'][0][2]
            valid_boundary = len(components) == 1 and components[0]['closed']
            connected_proximal = bool(np.any(faces[:, 0] == caps[1][0]))
            connects_distal = bool(np.any(faces[:, 0] == caps[0][0]))
            source_extent = bool(np.min(local[:, 0, :, 2]) >= floor-source_eval.EPS)
            valid = valid_boundary and connected_proximal and not connects_distal and source_extent
            result = [dict(valid=valid, classification='continuous proximal shoulder attachment' if valid else 'unresolved shoulder exterior',
                           reason='Closed proximal boundary, source seam extent and exclusion of distal closure checked together') for _ in local]
            components = [dict(closed_single_boundary=valid_boundary, proximal=connected_proximal,
                               distal=connects_distal, within_neutral_extent=source_extent, valid=valid)]
        return result, components

    def contact(self, seat, first, second, a, b, pairs, arrays, prefix):
        mapped, unresolved = mapped_segments(a, b, pairs, self.rest[first+'/rest_points'],
                                            self.rest[second+'/rest_points'], self.primitives)
        if mapped:
            world = np.asarray([r[2] for r in mapped])
            local = np.asarray([[r[3], r[4]] for r in mapped])
            maps = [source_map(name, surface['triangles'], self.topology)
                    for name, surface in ((first,a),(second,b))]
            faces = np.asarray([[maps[0][r[0]],maps[1][r[1]]] for r in mapped])
            result, components = self.classify(first, second, world, local, faces)
            arrays[prefix+'/world_segments'] = world
            arrays[prefix+'/source_segments'] = local
            arrays[prefix+'/source_faces'] = faces
        else:
            result, components = [], []
        invalid = [i for i,r in enumerate(result) if not r['valid']]
        arrays[prefix+'/pairs'] = np.asarray(pairs,dtype=np.int32)
        return dict(kind='arm_body', seat=seat, parts=[first,second], valid=not invalid and not unresolved,
                    residual=float(sum(np.linalg.norm(world[i,1]-world[i,0]) for i in invalid)*1000+len(unresolved)), invalid_segments=invalid,
                    unresolved=unresolved, components=components, classifications=result, witness=prefix)


def exposed(palm, support, normal, maximum_gap, occluders, arrays, prefix):
    """Continuous contact plus every foreign surface between support and palm."""
    result = patch.measure(palm['points'],palm['triangles'],support['points'],support['triangles'],normal,maximum_gap)
    basis = result['basis']
    st = (support['points']@basis)[support['triangles']]
    ht = (palm['points']@basis)[palm['triangles']]
    blocked=[]
    for name, surface in occluders.items():
        mesh=projected_all(surface['points'],surface['triangles'],basis)
        for cell,(hi,si) in enumerate(result['pairs']):
            poly=result['vertices'][result['offsets'][cell]:result['offsets'][cell+1]]
            sp=np.linalg.solve(np.column_stack((st[si,:,:2],np.ones(3))),st[si,:,2])
            hp=np.linalg.solve(np.column_stack((ht[hi,:,:2],np.ones(3))),ht[hi,:,2])
            ids=np.flatnonzero(np.all(mesh['high']>=poly.min(0),axis=1)&np.all(mesh['low']<=poly.max(0),axis=1))
            for index in ids:
                overlap=patch.intersect(list(poly),mesh['tri'][index,:,:2])
                lower=mesh['planes'][index]-sp; lower[2]-=1e-6
                upper=hp-mesh['planes'][index]; upper[2]-=1e-6
                overlap=patch.clip(patch.clip(overlap,lower),upper)
                if len(overlap)>=3 and abs(patch.signed_area(overlap))>1e-14:
                    blocked.append(dict(part=name,cell=cell,triangle=int(mesh['ids'][index]),area=abs(patch.signed_area(overlap))))
    for key,value in result.items():
        if isinstance(value,np.ndarray): arrays[prefix+'/'+key]=value
    summary={k:v for k,v in result.items() if not isinstance(v,np.ndarray)}
    finite=result['projected_area']>1e-10 and min(result['spans'])>1e-6
    return dict(kind='support',valid=finite and not blocked,residual=0. if finite and not blocked else 1.,
                blocked=blocked,**summary)
