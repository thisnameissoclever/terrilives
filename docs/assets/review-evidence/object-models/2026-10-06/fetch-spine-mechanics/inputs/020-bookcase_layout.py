"""Shallow shelving whose back stays on the tile edge through every rotation."""


def parts():
    def part(name, center, size, supports=(), material='wood', grounded=False):
        return dict(name=name, center=center, size=size, supports=list(supports),
                    material=material, grounded=grounded,
                    bevel=.004 if material == 'wood' else .001)

    rows = [part('Back panel', (0, .47, .74), (.86, .06, 1.48), grounded=True),
            part('Left side', (-.40, .36, .74), (.06, .28, 1.48), ['Back panel'], grounded=True),
            part('Right side', (.40, .36, .74), (.06, .28, 1.48), ['Back panel'], grounded=True),
            part('Base', (0, .36, .05), (.86, .28, .10),
                 ['Back panel', 'Left side', 'Right side'], grounded=True)]
    for shelf in range(1, 4):
        top = .10+shelf*.34
        rows.append(part(f'Shelf {shelf}', (0, .345, top-.03), (.76, .25, .06),
                         ['Back panel', 'Left side', 'Right side']))
    rows.append(part('Crown', (0, .35, 1.50), (.90, .30, .08),
                     ['Back panel', 'Left side', 'Right side']))
    palette = ['clay', 'sage', 'ochre', 'slate', 'plum', 'linen']
    for shelf in range(4):
        for index in range(6):
            height = .20+((shelf*3+index*2)%5)*.020
            bottom = .10+shelf*.34-.002
            rows.append(part(f'Book {shelf} {index}', (-.30+index*.12, .342, bottom+height/2),
                             (.096, .15, height), ['Base' if shelf == 0 else f'Shelf {shelf}'],
                             palette[(shelf+index)%6]))
    return rows
