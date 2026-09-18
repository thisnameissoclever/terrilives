"""Physical parts for the two-tile oak and metal desk."""


def parts():
    rows = []

    def add(name, center, size, material, supports=(), grounded=False, bevel=.008):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         supports=list(supports), grounded=grounded, bevel=bevel))

    for label, y in (('front', -.34), ('back', .34)):
        add(f'Left {label} leg', (-.82, y, .37), (.065, .065, .74),
            'metal', grounded=True)
    add('Left floor brace', (-.82, 0, .045), (.065, .72, .06), 'metal',
        ('Left front leg', 'Left back leg'))
    for x in (.425, .775):
        for y in (-.28, .28):
            add(f'Pedestal foot {x} {y}', (x, y, .055), (.075, .075, .11),
                'metal', ('Pedestal',), grounded=True)
    add('Pedestal', (.60, 0, .3975), (.51, .76, .655), 'wood')
    add('Front knee rail', (-.235, -.34, .70), (1.23, .06, .08), 'metal',
        ('Left front leg', 'Pedestal'))
    add('Rear rail', (0, .34, .70), (1.70, .06, .08), 'metal',
        ('Left back leg', 'Pedestal'))
    add('Desktop', (0, 0, .75), (1.86, .84, .06), 'top',
        ('Front knee rail', 'Rear rail', 'Pedestal'), bevel=.012)
    for index, z in enumerate((.19, .395, .60), start=1):
        front = f'Drawer {index}'
        add(front, (.60, -.375, z), (.465, .038, .188), 'top', ('Pedestal',), bevel=.006)
        for sign in (-1, 1):
            add(f'{front} mount {sign}', (.60+sign*.10, -.407, z),
                (.025, .04, .025), 'metal', (front,), bevel=.003)
        add(f'{front} pull', (.60, -.430, z), (.244, .032, .027), 'metal',
            (f'{front} mount -1', f'{front} mount 1'), bevel=.005)
    return rows
