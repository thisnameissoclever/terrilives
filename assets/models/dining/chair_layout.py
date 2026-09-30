"""Named wooden parts; front is local -X to preserve the original chair's facings."""


def bounds(part):
    center, size = part['center'], part['size']
    return (tuple(center[i]-size[i]/2 for i in range(3)),
            tuple(center[i]+size[i]/2 for i in range(3)))


def parts():
    rows = []

    def box(name, center, size, supports=(), grounded=False, bevel=.012, material='oak'):
        rows.append(dict(name=name, center=center, size=size, supports=list(supports),
                         grounded=grounded, bevel=bevel, material=material))

    for side, y in (('left', -.235), ('right', .235)):
        front, rear = f'Front leg {side}', f'Rear post {side}'
        box(front, (-.225, y, .245), (.08, .08, .49), grounded=True)
        box(rear, (.225, y, .545), (.08, .08, 1.09), grounded=True)
        box(f'Side apron {side}', (0, y, .425), (.49, .065, .13), (front, rear))
        box(f'Side stretcher {side}', (0, y, .205), (.49, .055, .065), (front, rear))
    for end, x in (('Front', -.225), ('Rear', .225)):
        supports = tuple(f'{"Front leg" if end == "Front" else "Rear post"} {side}'
                         for side in ('left', 'right'))
        box(f'{end} apron', (x, 0, .425), (.065, .51, .13), supports)
    box('Seat', (-.015, 0, .49), (.60, .62, .09),
        ('Front apron', 'Rear apron', 'Side apron left', 'Side apron right'),
        bevel=.032, material='seat')
    for index, height in enumerate((.72, .86, 1.0)):
        box(f'Back rail {index}', (.225, 0, height), (.075, .51, .09),
            ('Rear post left', 'Rear post right'), bevel=.02)
    return rows
