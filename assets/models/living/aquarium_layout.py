"""A compact cabinet and enclosed tank, with three small fish poses."""


def parts():
    def part(name, center, size, material, bevel=.004):
        return dict(name=name, center=center, size=size, material=material, bevel=bevel)
    rows = [part('Cabinet plinth', (0, 0, .04), (.88, .76, .08), 'wood'),
            part('Cabinet body', (0, 0, .345), (.82, .70, .54), 'wood'),
            part('Cabinet top', (0, 0, .65), (.90, .78, .07), 'wood'),
            part('Tank base', (0, 0, .705), (.84, .72, .05), 'charcoal'),
            part('Substrate', (0, 0, .748), (.78, .66, .045), 'sand'),
            part('Tank lid', (0, 0, 1.5875), (.84, .72, .045), 'charcoal')]
    for side, x in (('left', -.197), ('right', .197)):
        rows += [part(f'{side} cabinet door', (x, -.355, .345), (.375, .035, .465), 'door'),
                 part(f'{side} door handle', (x+(.13 if x < 0 else -.13), -.382, .37),
                      (.016, .022, .070), 'charcoal')]
    for x in (-.401, .401):
        for y in (-.341, .341):
            rows.append(part(f'Tank corner {x} {y}', (x, y, 1.145),
                             (.014, .014, .84), 'edge', .002))
    for y in (-.341, .341):
        rows.append(part(f'Glass long {y}', (0, y, 1.145), (.79, .006, .84), 'glass', 0))
    for x in (-.401, .401):
        rows.append(part(f'Glass end {x}', (x, 0, 1.145), (.006, .676, .84), 'glass', 0))
    return rows


def fish_poses(frame):
    if frame not in (0, 1):
        raise ValueError('Fish frame must be zero or one')
    return [dict(name='Amber fish', center=(-.25+.025*frame, 0, .98), direction=1, colour='amber'),
            dict(name='Blue fish', center=(.24-.022*frame, 0, .94), direction=-1, colour='blue'),
            dict(name='Coral fish', center=(.019*frame, 0, 1.00), direction=1, colour='coral')]
