"""Map retained arm crossings to immutable source anatomy without running Blender."""
import collections
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from classify_sofa_lap_contacts import functions_from, source_map


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mapped_segments(first, second, pairs, first_rest, second_rest, primitives):
    result, unresolved = [], []
    for ai, bi in pairs:
        av, bv = first['triangles'][ai], second['triangles'][bi]
        a, b = first['points'][av], second['points'][bv]
        segment = primitives['intersection_segment'](a, b)
        if segment['kind'] != 'segment':
            unresolved.append([int(ai), int(bi), segment])
            continue
        world = np.asarray(segment['endpoints'])
        local_a = np.asarray([primitives['barycentric'](p, a) @ first_rest[av] for p in world])
        local_b = np.asarray([primitives['barycentric'](p, b) @ second_rest[bv] for p in world])
        result.append((int(ai), int(bi), world, local_a, local_b))
    return result, unresolved


def run(root, output):
    output.mkdir(parents=True, exist_ok=False)
    directory = root / 'sofa-resting-clearance-01'
    receipt = json.loads((directory / 'proof.json').read_text())
    inputs = dict(receipt['inputs'])
    for path in [Path(__file__), root / 'classify_sofa_lap_contacts.py',
                 root / 'audit_sofa_binding.py', root / 'diagnose_sofa_hand_frames.py',
                 directory / 'proof.json', directory / 'phase-00.npz',
                 root / 'sofa-derived-binding-03/normalized-rest.npz',
                 root / 'sofa-binding-audit-01/source-binding.npz']:
        inputs[str(path.resolve())] = digest(path)
    for name, expected in inputs.items():
        if digest(Path(name)) != expected:
            raise ValueError('Changed retained input: ' + name)
    geometry = np.load(directory / 'phase-00.npz')
    rest = np.load(root / 'sofa-derived-binding-03/normalized-rest.npz')
    topology = np.load(root / 'sofa-binding-audit-01/source-binding.npz')
    primitives = functions_from(root / 'audit_sofa_binding.py')
    arrays, cases = {}, []
    wanted = ('Relaxed shirt sleeve', 'Turned sleeve cuff', 'Forearm with elbow and wrist sections')
    targets = ('Overshirt body', 'One sewn breast pocket', 'Turned sleeve cuff',
               'Turned sleeve cuff.001', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001')
    for entry in receipt['phases'][0]['self_contacts']:
        a, b = entry['parts']
        if not a.startswith(wanted) or b not in targets:
            continue
        seat = entry['seat']
        surfaces = [{key: geometry[f'{seat}/{name}/{key}'] for key in ('points', 'triangles')}
                    for name in (a, b)]
        rows, unresolved = mapped_segments(*surfaces, geometry[entry['witness_array']],
                                           rest[a + '/rest_points'], rest[b + '/rest_points'], primitives)
        prefix = 'case' + str(len(cases))
        face_maps = [source_map(name, surface['triangles'], topology)
                     for name, surface in zip((a, b), surfaces)]
        arrays[prefix + '/pairs'] = np.asarray([[r[0], r[1]] for r in rows], dtype=np.int32)
        arrays[prefix + '/world_segments'] = np.asarray([r[2] for r in rows])
        arrays[prefix + '/source_segments'] = np.asarray([[r[3], r[4]] for r in rows])
        arrays[prefix + '/source_faces'] = np.asarray([[face_maps[0][r[0]], face_maps[1][r[1]]] for r in rows])
        bounds = [[np.asarray([r[i] for r in rows]).reshape(-1, 3).min(0).tolist(),
                   np.asarray([r[i] for r in rows]).reshape(-1, 3).max(0).tolist()] for i in (3, 4)]
        failure = b == 'One sewn breast pocket' or (a.startswith('Turned sleeve cuff') and b == 'Overshirt body')
        cases.append(dict(seat=seat, parts=[a, b], pairs=len(rows), source_bounds=bounds,
                          source_face_count=[len(set(arrays[prefix + '/source_faces'][:, i])) for i in (0, 1)],
                          classification='Exterior garment crossing' if failure else 'Attachment candidate requiring source-region validation',
                          reason=('The cuff and lower sleeve belong to the upper arm; the breast pocket and shirt exterior are distinct torso surfaces, not these arm attachment seams.' if failure else
                                  'No whole-pair exemption: map both sides of each segment into the demonstrated source attachment region.'),
                          unresolved=unresolved, cache_prefix=prefix))
    np.savez(output / 'segments.npz', **arrays)
    proof = dict(state='complete', scope='Retained phase-zero source-segment classification only; no new pose or binding',
                 inputs=inputs, cases=cases, cache_sha256=digest(output / 'segments.npz'),
                 attachment_acceptance='Pending source-region controls and unified complete evaluator')
    for name, expected in inputs.items():
        if digest(Path(name)) != expected:
            raise ValueError('Input changed during analysis: ' + name)
    (output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(cases=len(cases), failures=sum(c['classification']=='Exterior garment crossing' for c in cases),
                         unresolved=sum(len(c['unresolved']) for c in cases), output=str(output))))


if __name__ == '__main__':
    run(*(Path(value).resolve() for value in sys.argv[1:]))
