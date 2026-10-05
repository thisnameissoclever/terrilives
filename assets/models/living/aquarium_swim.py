"""Eight cyclic, independently phased swimming samples for the accepted fish."""
import math

SAMPLE_COUNT = 8
FISH_NAMES = ('Amber fish', 'Blue fish', 'Coral fish')


def motion(frame):
    if type(frame) is not int or frame < 0:
        raise ValueError('Fish sample must be a nonnegative integer')
    phase = (frame % SAMPLE_COUNT) * math.tau / SAMPLE_COUNT
    result = []
    for index, name in enumerate(FISH_NAMES):
        angle = phase + index * math.tau / 3
        result.append({'name': name,
                       'translation': (.022*math.sin(angle),
                                       .004*math.sin(angle*2),
                                       .008*math.cos(angle)),
                       'tail_shift': .012*math.sin(angle*2 + .4)})
    return result
