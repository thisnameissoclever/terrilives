"""A centered table, long along local Y to retain the original SE footprint."""


def parts():
    rows = []

    def add(name, center, size, supports=(), grounded=False, bevel=.012, material='oak'):
        rows.append(dict(name=name, center=center, size=size, supports=list(supports),
                         grounded=grounded, bevel=bevel, material=material))

    for side, x in (('left', -.32), ('right', .32)):
        for end, y in (('near', -.76), ('far', .76)):
            add(f'Leg {side} {end}', (x, y, .3675), (.09, .09, .735), grounded=True)
        add(f'Long apron {side}', (x, 0, .68), (.075, 1.61, .10),
            (f'Leg {side} near', f'Leg {side} far'))
    for end, y in (('near', -.76), ('far', .76)):
        add(f'End apron {end}', (0, y, .68), (.70, .075, .10),
            (f'Leg left {end}', f'Leg right {end}'))
    add('Tabletop', (0, 0, .75), (.88, 1.86, .08),
        tuple(p['name'] for p in rows), bevel=.025, material='top')
    return rows
