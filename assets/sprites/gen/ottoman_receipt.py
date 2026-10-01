"""Validate archived ottoman evidence without requiring Blender in atlas builds."""
import json
import hashlib
import math
from pathlib import Path
import re
import sys
from contextlib import contextmanager

from offline_props import inside

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'models/living'))
from ottoman_bundle import digest, load_bundle, relative_path

BASE = 'output/ottoman-sit-candidate-02/'
FILES = {'manifest': BASE + 'offline-export/manifest.json',
         'raw_proof': BASE + 'contributions/raw-proof.json',
         'contact': BASE + 'strict-contact-proof-02.json',
         'comparison': BASE + 'offline-export/export-proof.json',
         'authoring': BASE + 'status.json',
         'occupancy': BASE + 'occupancy-regression-proof.json',
         'cadence': BASE + 'action-cadence.json',
         'preview': BASE + 'offline-export/cadence-proof.json'}
MODEL = BASE + 'ottoman-sit-authoring.blend'
AUTHOR = 'output/build-ottoman-sit-refined.py'
CHECKER = 'output/check-ottoman-sit-candidate-02.py'
VOLUME = 'output/surface_volume.py'
SIM = 'assets/models/sims/sim-01/'
LIVING = 'assets/models/living/'
FACINGS = ('SE', 'NW', 'SW', 'NE')
VARIANTS = ('green', 'blue', 'red')
DEPENDENCIES = {
    'authoring': {AUTHOR, SIM + 'sim-01-rigged.blend',
        LIVING + 'owner-review-pending/ottoman/candidate-01/ottoman-authoring.blend',
        LIVING + 'armchair_contact.py', LIVING + 'armchair_support.py',
        SIM + 'build_rig.py', SIM + 'rig_math.py', SIM + 'render_shirt_variants.py'},
    'contact': {MODEL, AUTHOR, CHECKER, VOLUME},
    'occupancy': {CHECKER, VOLUME, 'output/test_surface_volume.py',
        'output/prove-ottoman-occupancy.py',
        'output/ottoman-sit-candidate-01/ottoman-sit-authoring.blend'},
    'raw_proof': {'assets/models/' + name for name in (
        'living/armchair_contact.py', 'living/armchair_support.py',
        'bedroom/bunk_contact.py', 'bathroom/check_toilet_scene.py',
        'kitchen/check_stove_scene.py', 'kitchen/render_static.py',
        'furniture/animation_export.py', 'furniture/build_parts.py',
        'furniture/geometry.py', 'furniture/preview.py',
        'sims/sim-01/sim-01-rigged.blend', 'sims/sim-01/registered-canvas-proof.json',
        'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py',
        'sims/sim-01/render_job.py', 'sims/sim-01/build_rig.py',
        'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py')}
        | {MODEL, BASE + 'status.json', FILES['contact'], CHECKER, AUTHOR, VOLUME,
           'output/render-ottoman-sit-contributions.py'},
}


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def support_bounds(support):
    bounds, area = support.get('contact_bounds'), support.get('xy_hull_area')
    if (not isinstance(bounds, list) or len(bounds) != 2
            or any(not isinstance(v, list) or len(v) != 3 or not all(number(x) for x in v) for v in bounds)
            or any(bounds[0][i] > bounds[1][i] for i in range(3))
            or bounds[1][0] - bounds[0][0] < .08 or bounds[1][1] - bounds[0][1] < .12
            or not number(area) or area < .0024
            or area > (bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1]) + 1e-9):
        raise ValueError('Invalid ottoman support footprint')
    return bounds


def validate_contact(contact):
    if (contact.get('state') != 'complete' or contact.get('accepted') is not True
            or contact.get('source_bytes_unchanged') is not True
            or contact.get('approved_neck_boundary_sha256') !=
               'fc92ab041d93490f921c061921bbd6f281c5036d576e89fb741f2c5ac5f901e1'):
        raise ValueError('Incomplete ottoman contact proof')
    samples = contact.get('samples')
    if (not isinstance(samples, list) or len(samples) != 4
            or any(not isinstance(row, dict) or type(row.get('frame')) is not int for row in samples)
            or {row['frame'] for row in samples} != {1, 2, 3, 4}):
        raise ValueError('Incomplete ottoman contact samples')
    volumes = ['Cushion', 'Cushion welt', 'Forearm with elbow and wrist sections',
               'Forearm with elbow and wrist sections.001', 'Overshirt body',
               'Tailored trouser leg', 'Tailored trouser leg.001', 'Upholstered frame']
    for row in samples:
        if (type(row.get('body_pairs_checked')) is not int or row['body_pairs_checked'] != 12
                or row.get('body_furniture_intersections') != [] or row.get('body_self_intersections') != []
                or row.get('validated_volumes') != volumes
                or row.get('analysis_only_caps') != {'Overshirt body': 96}):
            raise ValueError('Ottoman collision evidence is incomplete or reports penetration')
        error = row.get('maximum_bone_length_error')
        if not number(error) or not 0 <= error < 1e-5:
            raise ValueError('Ottoman bone length changed')
        hip = row.get('hip_support', {})
        support_bounds(hip)
        gap, rays, count = (hip.get(key) for key in ('min_gap', 'ray_hits', 'contact_count'))
        if (not number(gap) or not 0 <= gap <= .003 or hip.get('near_gap_limit') != .01
                or type(rays) is not int or type(count) is not int or not rays >= count >= 3):
            raise ValueError('Invalid ottoman hip support measurement')
        floor = row.get('floor_support')
        if (not isinstance(floor, dict)
                or set(floor) != {'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}):
            raise ValueError('Incomplete ottoman floor support')
        for support in floor.values():
            bounds = support.get('contact_bounds')
            if (not isinstance(bounds, list) or len(bounds) != 2
                    or any(not isinstance(v, list) or len(v) != 3 or not all(number(x) for x in v) for v in bounds)
                    or not 0 <= bounds[0][2] <= .001 or not bounds[0][2] <= bounds[1][2] <= .003
                    or support.get('gap_limit') != .003
                    or type(support.get('point_count')) is not int or support['point_count'] < 3):
                raise ValueError('Invalid ottoman floor support')
            support_bounds(support)


def validate_raw(raw, samples):
    if (raw.get('state') != 'complete' or raw.get('source_bytes_unchanged') is not True
            or raw.get('blender_version') != '4.5.14 LTS'
            or raw.get('blender_build_hash') != '62c1db4208e8'):
        raise ValueError('Incomplete ottoman raw generation')
    anchor = raw.get('anchor')
    if (not isinstance(anchor, list) or len(anchor) != 2
            or any(not number(v) or abs(v - want) > .002 for v, want in zip(anchor, (48, 116.00044)))):
        raise ValueError('Ottoman camera registration changed')
    contacts = raw.get('contact_samples', {})
    if (not isinstance(contacts, dict) or set(contacts) != set(VARIANTS)
            or any(value != samples for value in contacts.values())):
        raise ValueError('Ottoman palette contact samples differ from strict source proof')
    expected = {(f, i, v, o) for f in FACINGS for i in range(4) for v in VARIANTS
                for o in ('beauty', 'sim', 'furniture', 'lines')}
    expected.update((f, 0, 'green', 'empty') for f in FACINGS)
    found, paths = set(), set()
    rows = raw.get('renders')
    if not isinstance(rows, list):
        raise ValueError('Missing ottoman raw coverage')
    for row in rows:
        key = tuple(row.get(name) for name in ('facing', 'frame', 'variant', 'owner'))
        if type(key[1]) is not int or key not in expected or key in found:
            raise ValueError('Invalid or duplicate ottoman raw coverage')
        found.add(key)
        filename = f'ottoman-sit-{key[2]}-{key[0]}-{key[1]}-{key[3]}.png'
        if row.get('path') != filename or filename in paths:
            raise ValueError('Ottoman raw path does not uniquely name its sample')
        paths.add(filename)
        if not isinstance(row.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', row['sha256']):
            raise ValueError('Invalid ottoman raw image digest')
    if found != expected:
        raise ValueError('Incomplete ottoman raw coverage')


def validate_comparison(report):
    if (report.get('state') != 'complete' or report.get('sources_unchanged') is not True
            or type(report.get('originals')) is not int or report['originals'] != 196
            or type(report.get('checked_groups')) is not int or report['checked_groups'] != 48):
        raise ValueError('Incomplete ottoman reconstruction evidence')
    expected = {(f, v, i) for f in FACINGS for v in VARIANTS for i in range(4)}
    rows, found = report.get('comparisons'), set()
    if not isinstance(rows, list):
        raise ValueError('Missing ottoman reconstruction samples')
    for row in rows:
        key = tuple(row.get(name) for name in ('facing', 'variant', 'frame'))
        if type(key[2]) is not int or key not in expected or key in found:
            raise ValueError('Invalid or duplicate ottoman reconstruction sample')
        found.add(key)
        for name in ('max_error', 'p95_error', 'active_pixels', 'pixels_above_8'):
            if type(row.get(name)) is not int or row[name] < 0:
                raise ValueError('Invalid ottoman reconstruction metric')
        if (row['max_error'] > 64 or row['p95_error'] > 12 or row['active_pixels'] == 0
                or row['p95_error'] > row['max_error'] or row['pixels_above_8'] > row['active_pixels']):
            raise ValueError('Ottoman reconstruction exceeds acceptance limits')
    if found != expected:
        raise ValueError('Incomplete ottoman reconstruction coverage')


def validate_bindings(bundle, values):
    bindings = {
        'authoring': {'candidate_sha256': MODEL},
        'manifest': {'raw_proof_sha256': FILES['raw_proof']},
        'comparison': {'raw_proof_sha256': FILES['raw_proof'], 'manifest_sha256': FILES['manifest'],
            'encoder_sha256': 'output/export-ottoman-sit-review.py',
            'partition_sha256': 'assets/models/furniture/layer_partition.py',
            'comparison_sha256': 'assets/models/furniture/export_contributions.py'},
        'cadence': {'model_sha256': MODEL, 'reader_sha256': 'output/read-ottoman-cadence.py'},
        'preview': {'model_sha256': MODEL, 'export_proof_sha256': FILES['comparison'],
            'action_cadence_sha256': FILES['cadence'], 'script_sha256': 'output/review-ottoman-cadence.py',
            'source_animation_sha256': BASE + 'offline-export/full-clip.webp',
            'preview_sha256': BASE + 'offline-export/full-clip-authored-cadence.webp'},
    }
    for receipt, fields in bindings.items():
        for field, name in fields.items():
            sha = values[receipt].get(field)
            if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):
                raise ValueError(f'Receipt hash missing: {receipt}.{field}')
            bundle.resolve(name, sha)
    if values['manifest'].get('anchor') != values['raw_proof'].get('anchor'):
        raise ValueError('Ottoman manifest registration differs from raw proof')
    refs = list(values['manifest'].get('empty', []))
    for row in values['manifest'].get('frames', []):
        refs.extend(row.get(role) for role in ('body', 'furniture', 'outline'))
    reviews = values['comparison'].get('review_files', [])
    if (not isinstance(reviews, list) or len(reviews) != 4
            or {row.get('path') for row in reviews} !=
               {'full-clip-green.png', 'full-clip-blue.png', 'full-clip-red.png', 'full-clip.webp'}):
        raise ValueError('Incomplete ottoman full-clip review files')
    refs.extend(reviews)
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get('sha256'), str):
            raise ValueError('Missing ottoman image binding')
        name = relative_path(ref.get('path'), historical=True)
        bundle.resolve(BASE + 'offline-export/' + name, ref['sha256'])


def validate_cadence(cadence, preview):
    if (cadence.get('state') != 'complete' or cadence.get('source_unchanged') is not True
            or cadence.get('action') != 'ottoman_sit'
            or type(cadence.get('loop_samples')) is not int or cadence['loop_samples'] != 4
            or type(cadence.get('sample_fps')) is not int or cadence['sample_fps'] != 2
            or preview.get('state') != 'complete' or preview.get('decoded_frames_unchanged') is not True
            or type(preview.get('sample_fps')) is not int or preview['sample_fps'] != 2
            or preview.get('frame_durations_ms') != [500, 500, 500, 500]):
        raise ValueError('Ottoman review cadence differs from the four-sample, two-FPS action')


def validate_occupancy(report):
    names = {'recorded_false_forearm_containment', 'candidate01_palm_thigh_crossing_still_rejected',
             'fully_enclosed_solid_rejected_in_both_orders', 'deleted_containment_guard_makes_enclosed_solid_pass',
             'disjoint_concave_surfaces_with_overlapping_boxes_pass', 'neck_entry_without_cloth_crossing_is_rejected',
             'deleted_cap_crossing_guard_makes_partial_intrusion_pass'}
    rows = report.get('cases')
    if (report.get('state') != 'complete' or report.get('source_bytes_unchanged') is not True
            or not isinstance(rows, list) or len(rows) != len(names)
            or any(not isinstance(row, dict) or row.get('passed') is not True for row in rows)
            or {row.get('name') for row in rows} != names):
        raise ValueError('Incomplete ottoman occupancy regressions')
    cases = {row['name']: row for row in rows}
    false_positive = cases['recorded_false_forearm_containment']
    normal = false_positive.get('old_normal_dot')
    if not number(normal) or normal >= 0 or false_positive.get('actual_contains') is not False:
        raise ValueError('Ottoman occupancy false-positive witness changed')
    for name, kind in (('candidate01_palm_thigh_crossing_still_rejected', 'surface'),
                       ('neck_entry_without_cloth_crossing_is_rejected', 'analysis_envelope_intrusion')):
        result = cases[name].get('result', {})
        if (result.get('kind') != kind or type(result.get('triangle_pairs')) is not int
                or result['triangle_pairs'] <= 0):
            raise ValueError('Ottoman occupancy rejection lost its collision witness')


def validate_authoring(report):
    if (report.get('state') != 'complete' or report.get('fit_passed') is not True
            or report.get('source_bytes_unchanged') is not True
            or report.get('blender_version') != '4.5.14 LTS'
            or report.get('preserved_scene_fingerprint') !=
               '34ed46973fe5b6d09469fb2a26a49eb72d1a77b15abb023000a43cc38f07e181'):
        raise ValueError('Incomplete ottoman authoring preservation evidence')


def load_receipt(catalog_path):
    catalog_path = Path(catalog_path).resolve()
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    if (type(catalog.get('version')) is not int or catalog['version'] != 1
            or catalog.get('review_status') != 'accepted-offline-independent-review'):
        raise ValueError('Ottoman export needs complete offline independent review')
    ref = catalog.get('bundle', {})
    path = inside(catalog_path.parent, ref.get('path'))
    if digest(path) != ref.get('sha256'):
        raise ValueError('Ottoman bundle receipt hash changed')
    bundle = load_bundle(path, root=catalog_path.parents[3])
    paths = {key: bundle.resolve(name) for key, name in FILES.items()}
    values = {key: json.loads(value.read_text()) for key, value in paths.items()}
    for key, field in (('authoring', 'source_hashes'), ('contact', 'inputs'),
                       ('occupancy', 'inputs'), ('raw_proof', 'signature')):
        inputs = values[key].get(field)
        if (not isinstance(inputs, dict) or len(inputs) != len(DEPENDENCIES[key])
                or {relative_path(name, historical=True) for name in inputs} != DEPENDENCIES[key]):
            raise ValueError(f'Ottoman {key} dependency inventory changed')
        for name, sha in inputs.items():
            if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):
                raise ValueError(f'Invalid ottoman dependency digest: {name}')
            bundle.resolve(name, sha)
    for name in (LIVING + 'armchair_layout.py', 'assets/models/furniture/render_provenance.py'):
        bundle.resolve(name)
    validate_contact(values['contact'])
    validate_raw(values['raw_proof'], values['contact'].get('samples'))
    validate_comparison(values['comparison'])
    validate_bindings(bundle, values)
    validate_cadence(values['cadence'], values['preview'])
    validate_occupancy(values['occupancy'])
    validate_authoring(values['authoring'])
    return paths


@contextmanager
def receipt_session(catalog_path):
    """Pin the evidence used by a multi-step verification, including its catalogue."""
    catalog_path = Path(catalog_path).resolve()
    catalog_bytes = catalog_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    bundle_path = inside(catalog_path.parent, catalog.get('bundle', {}).get('path'))
    bindings = {'catalog_sha256': hashlib.sha256(catalog_bytes).hexdigest(),
                'bundle_sha256': digest(bundle_path)}
    paths = load_receipt(catalog_path)
    yield paths, dict(bindings)
    if (digest(catalog_path) != bindings['catalog_sha256']
            or digest(bundle_path) != bindings['bundle_sha256']):
        raise ValueError('Ottoman evidence changed during verification')
    load_receipt(catalog_path)
