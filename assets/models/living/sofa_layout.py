"""Centered three-cushion sofa; local -X faces into the room in SE."""


def bounds(part):
    center, size = part['center'], part['size']
    return (tuple(center[i]-size[i]/2 for i in range(3)),
            tuple(center[i]+size[i]/2 for i in range(3)))


def parts():
    rows = []

    def add(name, center, size, supports=(), grounded=False, bevel=.035, material='fabric'):
        rows.append(dict(name=name, center=center, size=size, supports=list(supports),
                         grounded=grounded, bevel=bevel, material=material))

    for end, x in (('front', -.29), ('rear', .29)):
        for side, y in (('left', -.75), ('right', .75)):
            add(f'Foot {end} {side}', (x, y, .11), (.10, .11, .22),
                grounded=True, bevel=.012, material='wood')
    add('Upholstered base', (0, 0, .29), (.86, 1.86, .24),
        tuple(p['name'] for p in rows), bevel=.045)
    add('Upholstered back', (.335, 0, .68), (.20, 1.78, .74),
        ('Upholstered base',), bevel=.065)
    for side, y in (('left', -.86), ('right', .86)):
        add(f'Arm {side}', (0, y, .475), (.84, .14, .55),
            ('Upholstered base', 'Upholstered back'), bevel=.055)
    for index, y in enumerate((-.52, 0, .52)):
        add(f'Seat cushion {index}', (-.075, y, .47), (.66, .51, .18),
            ('Upholstered base',), bevel=.045, material='cushion')
        add(f'Back cushion {index}', (.21, y, .765), (.20, .51, .50),
            ('Upholstered back', f'Seat cushion {index}'), bevel=.07, material='cushion')
    return rows
