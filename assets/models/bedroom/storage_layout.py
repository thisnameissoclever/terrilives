"""Closed cabinet parts in the registered model coordinate system."""


def parts(kind):
    dimensions = {'nightstand': (.52, .48, .52, 2), 'dresser': (.88, .50, .95, 3)}
    if kind not in dimensions:
        raise ValueError(f'Unknown storage model: {kind}')
    width, depth, height, drawers = dimensions[kind]
    rows = []

    def add(name, center, size, material, support=None, bevel=.008):
        rows.append(dict(name=name, center=center, size=size, material=material,
                         support=support, bevel=bevel))

    for x in (-width/2+.065, width/2-.065):
        for y in (-depth/2+.065, depth/2-.065):
            add(f'Foot {x} {y}', (x, y, .07), (.085, .085, .14), 'dark')
    add('Case', (0, 0, (height+.09)/2), (width-.035, depth-.035, height-.09), 'wood')
    add('Top', (0, 0, height-.022), (width, depth, .044), 'top', 'Case')
    add('Back inset', (0, depth/2-.012, height/2),
        (width-.10, .015, height-.18), 'dark', 'Case', .004)
    usable = height-.18
    step = usable/drawers
    for index in range(drawers):
        z = .11+step*(index+.5)
        front = f'Drawer {index+1}'
        y = -depth/2+.008
        add(front, (0, y, z), (width-.075, .028, step-.015), 'top', 'Case', .006)
        for sign in (-1, 1):
            add(front+f' handle mount {sign}', (sign*.105, y-.028, z),
                (.026, .045, .027), 'metal', front, .004)
        add(front+' handle', (0, y-.048, z), (.244, .027, .026),
            'metal', front+' handle mount -1', .006)
    if kind == 'nightstand':
        add('Book lower cover', (.045, .015, height+.003), (.19, .14, .008), 'book', 'Top', .002)
        add('Book pages', (.045, .018, height+.015), (.18, .129, .024), 'paper', 'Book lower cover', .002)
        add('Book upper cover', (.045, .015, height+.029), (.19, .14, .008), 'book', 'Book pages', .002)
        add('Book spine', (.045, -.047, height+.016), (.19, .012, .032), 'book', 'Book pages', .002)
    return rows
