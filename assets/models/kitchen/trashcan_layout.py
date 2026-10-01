"""Dimensions of a closed, one-tile pedal bin; front is negative Y."""


def parts():
    return [
        dict(name='Base', kind='cylinder', radius=.225, bottom=0, top=.055,
             material='rubber', supports=[]),
        dict(name='Body', kind='cylinder', radius=.21, bottom=.04, top=.61,
             material='enamel', supports=['Base']),
        dict(name='Lid', kind='cylinder', radius=.223, bottom=.598, top=.64,
             material='lid', supports=['Body']),
        dict(name='Rear hinge', kind='box', center=(0, .205, .605),
             size=(.13, .07, .065), material='dark', supports=['Body', 'Lid']),
        dict(name='Pedal', kind='box', center=(0, -.242, .038),
             size=(.16, .13, .032), material='dark', supports=['Base']),
    ]
