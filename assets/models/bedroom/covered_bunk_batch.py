"""Finite source scenes and reciprocal visible owners for one sleeping place."""
FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')
SCRIPTS = ('covered_bunk_sleep.py', 'bunk_sleep_cloth.py', 'covered_bunk_contact.py',
           'bunk_contact.py', 'double_bed_sleep.py', 'double-bed-sleep-pose.json',
           'double_bed_receipt.py', 'double_bed_witnesses.py', 'covered_bunk_batch.py',
           'render_covered_bunk_sleep.py')


def groups():
    return [(mask, facing, color, 'green', 0)
            for facing in FACINGS for mask in (0, 1)
            for color in PALETTES if mask or color == 'green']


def owners(mask):
    if type(mask) is not int or mask not in (0, 1):
        raise ValueError('Expected one-place occupancy')
    return ('beauty', 'furniture', 'lines') + (('sim0',) if mask else ())


def expected_keys():
    return {(*group, owner) for group in groups() for owner in owners(group[0])}
