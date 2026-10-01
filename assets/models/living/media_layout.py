"""Named, attached media-cabinet solids; the functional face is local -Y."""


def parts(kind):
    rows = []

    def add(name, center, size, material, supports=(), grounded=False, bevel=.012):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         supports=list(supports), grounded=grounded, bevel=bevel))

    if kind == 'television':
        for x in (-.30, .30):
            for y in (-.13, .13):
                add(f'Foot {x} {y}', (x, y, .14), (.075, .075, .28),
                    'dark', grounded=True)
        add('Cabinet', (0, 0, .52), (.94, .46, .57), 'wood',
            tuple(p['name'] for p in rows), bevel=.032)
        add('Front bezel', (0, -.23, .525), (.86, .05, .49), 'dark',
            ('Cabinet',), bevel=.035)
        add('Glass screen', (-.10, -.26, .525), (.57, .03, .39), 'glass',
            ('Front bezel',), bevel=.055)
        for label, z in (('Tuning', .645), ('Volume', .46)):
            add(f'{label} control', (.305, -.266, z), (.085, .048, .085),
                'brass', ('Front bezel',), bevel=.038)
        add('Rear cover', (0, .231, .525), (.74, .032, .42), 'dark',
            ('Cabinet',), bevel=.024)
        for index, z in enumerate((.42, .48, .54, .60)):
            add(f'Rear vent {index}', (0, .249, z), (.46, .008, .012),
                'vent', ('Rear cover',), bevel=.004)
    elif kind == 'radio':
        for x in (-.29, .29):
            for y in (-.11, .11):
                add(f'Foot {x} {y}', (x, y, .07), (.075, .07, .14),
                    'dark', grounded=True, bevel=.009)
        add('Cabinet', (0, 0, .30), (.82, .34, .38), 'wood',
            tuple(p['name'] for p in rows), bevel=.025)
        add('Speaker grille', (-.11, -.175, .30), (.49, .028, .26), 'dark',
            ('Cabinet',), bevel=.02)
        for index, z in enumerate((.22, .26, .30, .34, .38)):
            add(f'Grille rib {index}', (-.11, -.188, z), (.43, .012, .009),
                'brass', ('Speaker grille',), bevel=.003)
        add('Tuning scale', (.255, -.17, .38), (.16, .025, .055), 'glass',
            ('Cabinet',), bevel=.007)
        add('Volume control', (.255, -.18, .265), (.095, .04, .095),
            'brass', ('Cabinet',), bevel=.04)
        add('Antenna', (-.28, .10, .575), (.018, .018, .25), 'brass',
            ('Cabinet',), bevel=.008)
        add('Rear cover', (0, .17, .30), (.66, .028, .27), 'dark',
            ('Cabinet',), bevel=.015)
    else:
        raise ValueError(f'Unknown media cabinet: {kind}')
    return rows
