"""A compact wooden stand with fabric folded over its right-hand rail."""
import math


def parts():
    return [
        dict(name='Base', shape='box', center=(0, 0, .035), size=(.38, .38, .07), supports=[]),
        dict(name='Collar', shape='box', center=(0, 0, .085), size=(.105, .105, .07), supports=['Base']),
        dict(name='Upright', shape='box', center=(0, 0, .72), size=(.064, .064, 1.30), supports=['Base', 'Collar']),
        dict(name='Rail', shape='rod', a=(-.23, 0, 1.27), b=(.30, 0, 1.27), radius=.02, supports=['Upright']),
        dict(name='Left end', shape='rod', a=(-.24, 0, 1.27), b=(-.222, 0, 1.27), radius=.027, supports=['Rail']),
        dict(name='Right end', shape='rod', a=(.292, 0, 1.27), b=(.31, 0, 1.27), radius=.027, supports=['Rail']),
        dict(name='Finial', shape='box', center=(0, 0, 1.379), size=(.086, .086, .07), supports=['Upright']),
    ]


def drape_point(t, u):
    """Continuous mid-surface; its 2 mm thickness rests on the 20 mm rail."""
    radius, height = .021, 1.27
    if t < .45:
        fall = (.45-t)/.45
        y, z = -radius-.034*fall, height-.77*fall
        sign = -1
    elif t > .55:
        fall = (t-.55)/.45
        y, z = radius+.034*fall, height-.63*fall
        sign = 1
    else:
        angle = (t-.45)/.10*math.pi
        y, z = -radius*math.cos(angle), height+radius*math.sin(angle)
        fall, sign = 0, 0
    width = .17+.07*fall
    y += sign*.007*math.sin(u*math.tau*2)*fall
    z += .006*math.sin(u*math.tau)*fall**4
    return (.172+(u-.5)*width, y, z)
