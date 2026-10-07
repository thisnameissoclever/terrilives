"""Construct one book-relative palm support contract from immutable cached surfaces."""
import hashlib
import json
import os
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import continuous_support_patch as contact


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source, output):
    output.mkdir(parents=True, exist_ok=False)
    proof = json.loads((source / 'proof.json').read_text())
    cache = np.load(source / 'case-00.npz')
    inputs = {str(p.resolve()): digest(p) for p in (Path(__file__), source / 'proof.json', source / 'case-00.npz', Path(contact.__file__))}
    result = dict(state='running', pid=os.getpid(), inputs=inputs, hands={}, contact_gap=.0005, maximum_gap=.0015,
                  construction='Rigid hand placement from measured broad palm surfaces and finite cover undersides; original book frame retained')
    arrays = {}
    for side, suffix in (('L', ''), ('R', '.001')):
        palm_name, thumb_name, cover_name = (name + suffix for name in ('Relaxed palm', 'Resting thumb', 'Reading book cover'))
        palm, thumb, cover = (cache[name + '/book_relative_points'] for name in (palm_name, thumb_name, cover_name))
        triangles = cache[cover_name + '/triangles']
        tri = cover[triangles]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        n /= np.linalg.norm(n, axis=1)[:, None]
        underside_id = int(np.argmin(n[:, 1]))
        up = -n[underside_id]
        eig, axes = np.linalg.eigh(np.cov(palm.T))
        major, normal = axes[:, -1], axes[:, 0]
        old = np.asarray(proof['cases'][0]['relative_hand_book'][side])
        if major @ old[:3, 1] < 0:
            major = -major
        if normal @ (thumb.mean(0) - palm.mean(0)) > 0:
            normal = -normal
        initial = np.column_stack((np.cross(major, normal), major, normal))
        forward = old[:3, 1].copy()
        forward -= up * (forward @ up)
        forward /= np.linalg.norm(forward)
        target = np.column_stack((np.cross(forward, up), forward, up))
        rotation = target @ initial.T
        center = cover.mean(0)
        lateral = np.asarray([1., 0., 0.])
        lateral -= up * (lateral @ up)
        lateral /= np.linalg.norm(lateral)
        rotated_palm = (palm - palm.mean(0)) @ rotation.T
        if side == 'L':
            target_lateral = float(np.min(cover @ lateral) - np.min(rotated_palm @ lateral))
        else:
            target_lateral = float(np.max(cover @ lateral) - np.max(rotated_palm @ lateral))
        center += lateral * (target_lateral - center @ lateral)
        translation = center - rotation @ palm.mean(0)
        placed = palm @ rotation.T + translation
        underside = float(tri[underside_id, 0] @ up)
        translation += up * (underside - .0005 - float(np.max(placed @ up)))
        transform = np.eye(4)
        transform[:3, :3], transform[:3, 3] = rotation, translation
        frame = transform @ old
        points = {}
        for name, values in ((palm_name, palm), (thumb_name, thumb)):
            values = values @ rotation.T + translation
            points[name] = values
            arrays[name + '/points'] = values
            arrays[name + '/triangles'] = cache[name + '/triangles']
        measured = contact.measure(cover, triangles, points[palm_name], cache[palm_name + '/triangles'], up, .0015)
        summary = {}
        for key, value in measured.items():
            if isinstance(value, np.ndarray):
                arrays[side + '/contact/' + key] = value
            else:
                summary[key] = value
        solids = []
        for book_name in ('Reading book cover', 'Reading book cover.001', 'Reading book pages', 'Reading book pages.001'):
            vertices = cache[book_name + '/book_relative_points']
            bt = vertices[cache[book_name + '/triangles']]
            bn = np.cross(bt[:, 1]-bt[:, 0], bt[:, 2]-bt[:, 0]); bn /= np.linalg.norm(bn, axis=1)[:, None]
            for name, hp in points.items():
                signed = np.einsum('nkd,kd->nk', hp[:, None]-bt[None, :, 0], bn)
                inside = np.all(signed < -1e-6, axis=1)
                arrays[name + '/' + book_name + '/inside'] = np.flatnonzero(inside)
                solids.append(dict(hand=name, book=book_name, inside_vertices=int(inside.sum())))
        result['hands'][side] = dict(book_relative_frame=frame.tolist(), source_palm_eigenvalues=eig.tolist(), support=cover_name,
            underside_triangle=underside_id, support_normal=up.tolist(), contact=summary, convex_vertex_checks=solids,
            upper_palm_gap=underside-float(np.max(points[palm_name]@up)), thumb_under_plane_clearance=underside-float(np.max(points[thumb_name]@up)))
    for name in ('Reading book cover', 'Reading book cover.001', 'Reading book pages', 'Reading book pages.001'):
        arrays[name + '/points'] = cache[name + '/book_relative_points']
        arrays[name + '/triangles'] = cache[name + '/triangles']
    np.savez(output / 'geometry.npz', **arrays)
    result.update(state='complete', cache_sha256=digest(output/'geometry.npz'), acceptance='Cached construction only; full Blender frame, collision and visual verification pending')
    assert all(digest(Path(p)) == sha for p, sha in inputs.items())
    (output / 'contract.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({side: {k: v for k,v in row.items() if k in ('contact','upper_palm_gap','thumb_under_plane_clearance')} for side,row in result['hands'].items()}, indent=2))


if __name__ == '__main__':
    run(Path(sys.argv[1]), Path(sys.argv[2]))
