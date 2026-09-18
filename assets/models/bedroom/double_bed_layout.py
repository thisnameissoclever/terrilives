"""A centered double-width frame fitted to the authored 2x2 footprint."""


def parts():
    rows = []

    def add(name, center, size, material, support=None, bevel=.012):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         support=support, bevel=bevel))

    for x in (-.74, .74):
        for y in (-.88, .88):
            add(f'Foot {x} {y}', (x, y, .11), (.12, .12, .22), 'wood')
    for x in (-.765, .765):
        add(f'Side rail {x}', (x, 0, .25), (.09, 1.94, .22), 'wood')
    add('Foot rail', (0, -.93, .25), (1.60, .08, .22), 'wood', 'Side rail -0.765')
    add('Headboard', (0, .94, .60), (1.62, .08, .80), 'wood', 'Side rail -0.765', .022)
    add('Headboard inset', (0, .897, .72), (1.38, .02, .35), 'wood_light', 'Headboard', .018)
    add('Mattress platform', (0, 0, .265), (1.50, 1.86, .08), 'wood', 'Side rail -0.765')
    add('Mattress', (0, 0, .375), (1.50, 1.86, .19), 'linen', 'Mattress platform', .055)
    add('Sage duvet', (0, -.24, .49), (1.54, 1.36, .12), 'sage', 'Mattress', .046)
    add('Folded duvet edge', (0, .397, .548), (1.50, .12, .04), 'sage_light', 'Sage duvet', .015)
    for x in (-.385, .385):
        add(f'Pillow {x}', (x, .675, .52), (.61, .40, .14), 'linen', 'Mattress', .060)
    return rows
