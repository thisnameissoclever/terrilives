"""Acceptance bounds for evaluated contact geometry, independent of Blender."""
import math


def validate_contact_report(report):
    if report.get('obstacle_count') != 6 or report.get('shoe_count') != 4:
        raise ValueError('Evaluated collision inventory is incomplete')
    expected = {(frame,side) for frame in range(16) for side in ('L','R')}
    contacts = report['contacts']
    keys = [(row['sample'],row['side']) for row in contacts]
    if report['samples'] != 16 or len(keys) != 32 or set(keys) != expected:
        raise ValueError('Incomplete evaluated contact coverage')
    if report['collisions']:
        raise ValueError('Shoe/furniture mesh intersection')
    for row in contacts:
        support = row.get('support_gap')
        if support is None or not math.isfinite(support) or abs(support) > 1e-5:
            raise ValueError('Pedal centre does not support the shoe sole')
        if not math.isfinite(row['gap']) or abs(row['gap']) > 1e-5:
            raise ValueError('Shoe sole does not contact the pedal top')
