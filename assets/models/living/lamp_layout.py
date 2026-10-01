"""A flared cream shade on a slim metal stand; dimensions use the shared model scale."""


def parts():
    rows = []

    def lathe(name, profile, material, supports=(), grounded=False):
        rows.append(dict(name=name, shape='lathe', profile=profile,
                         material=material, supports=list(supports), grounded=grounded))

    lathe('Base', [(0, 0), (.16, 0), (.175, .018), (.17, .042),
                   (.13, .065), (0, .065)], 'metal', grounded=True)
    lathe('Stem', [(0, .05), (.021, .05), (.021, .99), (0, .99)], 'metal', ('Base',))
    lathe('Base collar', [(0, .04), (.04, .04), (.034, .095), (0, .095)],
          'metal', ('Base', 'Stem'))
    lathe('Socket', [(0, .95), (.036, .95), (.036, 1.035), (0, 1.035)], 'metal', ('Stem',))
    lathe('Bulb', [(0, 1.02), (.022, 1.02), (.024, 1.075),
                   (.05, 1.12), (.046, 1.155), (.025, 1.18), (0, 1.19)], 'bulb', ('Socket',))
    for side, x in [('L', -.09), ('R', .09)]:
        rows.append(dict(name=f'Harp lower {side}', shape='rod', a=(0, 0, 1.0),
                         b=(x, 0, 1.075), radius=.006, material='metal',
                         supports=['Socket'], grounded=False))
        rows.append(dict(name=f'Harp upright {side}', shape='rod', a=(x, 0, 1.07),
                         b=(x, 0, 1.333), radius=.006, material='metal',
                         supports=[f'Harp lower {side}'], grounded=False))
    for axis, a, b in [('X', (-.15, 0, 1.33), (.15, 0, 1.33)),
                       ('Y', (0, -.15, 1.33), (0, .15, 1.33))]:
        rows.append(dict(name=f'Shade support {axis}', shape='rod', a=a, b=b,
                         radius=.006, material='metal',
                         supports=['Harp upright L', 'Harp upright R'] if axis == 'X' else ['Shade support X'],
                         grounded=False))
    lathe('Shade', [(.28, .95), (.15, 1.34), (.141, 1.34), (.271, .95)],
          'cream', ('Shade support X', 'Shade support Y'))
    lathe('Finial', [(0, 1.323), (.018, 1.323), (.018, 1.345), (.032, 1.345),
                    (.036, 1.36), (.022, 1.38), (0, 1.38)], 'metal', ('Shade support X',))
    return rows
