"""Centered bunk geometry; SE rotation occupies the existing 2x1 footprint."""


def parts():
    rows = []

    def add(name, center, size, material='wood', support=None, bevel=.012):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         support=support, bevel=bevel))

    for x in (-.43, .43):
        for y in (-.925, .925):
            add(f'Post {x} {y}', (x, y, 1.01), (.10, .10, 2.02))
    for label, offset in (('Lower', 0), ('Upper', 1.0)):
        for x in (-.425, .425):
            add(f'{label} side rail {x}', (x, 0, .32+offset), (.07, 1.88, .16),
                support=f'Post {-.43 if x < 0 else .43} -0.925')
        for y in (-.925, .925):
            add(f'{label} end rail {y}', (0, y, .32+offset), (.86, .08, .16),
                support=f'Post -0.43 {y}')
        add(f'{label} platform', (0, 0, .32+offset), (.82, 1.86, .08),
            support=f'{label} side rail -0.425')
        add(f'{label} mattress', (0, 0, .40739448+offset), (.76, 1.86, .12),
            'sage' if label == 'Lower' else 'linen', f'{label} platform', .04)
        add(f'{label} pillow', (0, .68, .5124+offset), (.64, .38, .14),
            'linen', f'{label} mattress', .05)
        if label == 'Upper':
            add(f'{label} duvet', (0, -.235, .491+offset), (.78, 1.27, .12),
                'sage', f'{label} mattress', .04)
            add(f'{label} duvet fold', (0, .35, .549+offset), (.76, .12, .04),
                'sage_light', f'{label} duvet', .012)
    add('Upper rear guard', (-.43, 0, 1.79), (.07, 1.86, .10),
        support='Post -0.43 -0.925')
    add('Upper access guard', (.43, .25, 1.79), (.07, 1.36, .10),
        support='Post 0.43 0.925')
    add('Upper access upright', (.43, -.40, 1.57), (.07, .07, .48),
        support='Upper side rail 0.425')
    for y in (-.925, .925):
        add(f'Upper end guard {y}', (0, y, 1.79), (.86, .08, .10),
            support=f'Post -0.43 {y}')
    for y in (-.82, -.43):
        add(f'Ladder upright {y}', (.46, y, .77), (.045, .06, 1.54),
            support='Upper side rail 0.425')
    for z in (.24, .54, .84, 1.14, 1.44):
        add(f'Ladder rung {z}', (.46, -.625, z), (.045, .40, .06),
            support='Ladder upright -0.82')
    return rows
