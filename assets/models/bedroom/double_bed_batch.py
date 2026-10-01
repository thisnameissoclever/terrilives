"""Finite static render inventory shared by the writer and strict exporter."""
import itertools

PALETTES = ('green', 'blue', 'red')
FACINGS = ('SE', 'NW', 'SW', 'NE')
SCRIPTS = ('double_bed_sleep.py', 'double-bed-sleep-pose.json',
           'render_double_bed_sleep.py', 'double_bed_receipt.py', 'double_bed_batch.py',
           'double_bed_witnesses.py')


def groups(pilot):
    if pilot:
        return [(3, 'NE', a, b, 0) for a, b in
                (('green', 'green'), ('blue', 'green'), ('green', 'red'), ('blue', 'red'))] + [
                    (1, 'SW', 'blue', 'green', 0), (2, 'SW', 'green', 'red', 0),
                    (0, 'SE', 'green', 'green', 0), (3, 'NE', 'green', 'green', 1)]
    return [(mask, facing, a, b, 0) for facing in FACINGS for mask in (0, 1, 2, 3)
            for a, b in itertools.product(PALETTES if mask & 1 else ('green',),
                                          PALETTES if mask & 2 else ('green',))]


def owners(mask):
    return ('beauty', 'furniture', 'lines') + tuple(f'sim{i}' for i in (0, 1) if mask & (1 << i))


def row_key(row):
    palettes = row['palettes']
    if len(palettes) != 2:
        raise ValueError('Expected one palette for each place')
    return (row['occupancy'], row['facing'], *palettes, row['sample'], row['owner'])


def expected_keys(pilot):
    return {(*group, owner) for group in groups(pilot) for owner in owners(group[0])}
