"""Low-backed armchair with the existing local -X seating direction."""


def parts():
    rows = []

    def add(name, center, size, supports=(), grounded=False, bevel=.035, material='fabric'):
        rows.append(dict(name=name, center=center, size=size, supports=list(supports),
                         grounded=grounded, bevel=bevel, material=material))

    for x in (-.18, .28):
        for y in (-.30, .30):
            add(f'Foot {x} {y}', (x, y, .12), (.11, .11, .24),
                grounded=True, bevel=.012, material='wood')
    add('Upholstered base', (.055, 0, .235), (.57, .82, .19),
        tuple(part['name'] for part in rows), bevel=.045)
    add('Upholstered back', (.30, 0, .68), (.18, .78, .76),
        ('Upholstered base',), bevel=.055)
    for side, y in (('left', -.345), ('right', .345)):
        add(f'Arm {side}', (.02, y, .395), (.64, .15, .39),
            ('Upholstered base', 'Upholstered back'), bevel=.045)
    add('Seat cushion', (.02, 0, .349), (.48, .58, .11),
        ('Upholstered base',), bevel=.035, material='cushion')
    add('Back cushion', (.205, 0, .695), (.14, .56, .63),
        ('Upholstered back', 'Seat cushion'), bevel=.045, material='cushion')
    return rows
