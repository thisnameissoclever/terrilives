"""A centered double-width frame fitted to the authored 2x2 footprint."""


def parts():
    rows = []

    def add(name, center, size, material, support=None, bevel=.012):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         support=support, bevel=bevel))

    for x in (-.79, .79):
        for y in (-.85, .85):
            add(f'Foot {x} {y}', (x, y, .11), (.12, .12, .22), 'wood')
    for x in (-.815, .815):
        add(f'Side rail {x}', (x, 0, .25), (.09, 1.86, .22), 'wood')
    add('Foot rail', (0, -.89, .25), (1.70, .10, .22), 'wood', 'Side rail -0.815')
    add('Headboard', (0, .925, .60), (1.72, .09, .80), 'wood', 'Side rail -0.815', .022)
    add('Headboard inset', (0, .879, .72), (1.48, .02, .35), 'wood_light', 'Headboard', .018)
    add('Mattress platform', (0, 0, .265), (1.60, 1.76, .08), 'wood', 'Side rail -0.815')
    add('Mattress', (0, 0, .375), (1.60, 1.76, .19), 'linen', 'Mattress platform', .055)
    add('Sage duvet', (0, -.215, .49), (1.64, 1.25, .12), 'sage', 'Mattress', .046)
    add('Folded duvet edge', (0, .365, .548), (1.60, .12, .04), 'sage_light', 'Sage duvet', .015)
    for x in (-.415, .415):
        add(f'Pillow {x}', (x, .64, .52), (.64, .40, .14), 'linen', 'Mattress', .060)
    return rows
