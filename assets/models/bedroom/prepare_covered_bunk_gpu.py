"""Build independent fractional samples from full original owner renders."""
import json
import math
from pathlib import Path

from PIL import Image
from double_bed_linear import encode
from export_covered_bunk_sleep import load_batch

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def recolour(rgb, shift):
    if shift == [0, 0, 0]:
        return rgb
    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    lms = [sum(a*b for a, b in zip(row, linear))**(1/3) for row in
           ((.4122214708, .5363325363, .0514459929),
            (.2119034982, .6806995451, .1073969566), (.0883024619, .2817188376, .6299787005))]
    lab = [sum(a*b for a, b in zip(row, lms)) for row in
           ((.2104542553, .7936177850, -.0040720468),
            (1.9779984951, -2.4285922050, .4505937099), (.0259040371, .7827717662, -.8086757660))]
    c, s = math.cos(math.radians(shift[0])), math.sin(math.radians(shift[0]))
    value = [min(1, max(0, lab[0]+shift[2])), (c*lab[1]-s*lab[2])*(1+shift[1]),
             (s*lab[1]+c*lab[2])*(1+shift[1])]
    back = [sum(a*b for a, b in zip(row, value))**3 for row in
            ((1, .3963377774, .2158037573), (1, -.1055613458, -.0638541728), (1, -.0894841775, -1.2914855480))]
    result = [min(1, max(0, sum(a*b for a, b in zip(row, back)))) for row in
              ((4.0767416621, -3.3077115913, .2309699292), (-1.2684380046, 2.6097574011, -.3413193965),
               (-.0041960863, -.7034186147, 1.7076147010))]
    return [v*12.92 if v <= .0031308 else 1.055*v**(1/2.4)-.055 for v in result]


def sample(image, x, y):
    x, y = min(image.width-1, max(0, x)), min(image.height-1, max(0, y))
    a, b = math.floor(x), math.floor(y)
    ax, ay = x-a, y-b
    points = ((a, b), (min(a+1, image.width-1), b),
              (a, min(b+1, image.height-1)), (min(a+1, image.width-1), min(b+1, image.height-1)))
    weights = ((1-ax)*(1-ay), ax*(1-ay), (1-ax)*ay, ax*ay)
    return [sum(image.getpixel(point)[channel]*weight for point, weight in zip(points, weights))/255 for channel in range(4)]


def run():
    raw = BASE/'owner-review-pending/bunk/covered-sleep/contributions-01'
    proof, paths = load_batch(raw, process_exited=True)
    records = []
    # The independently measured full scene crop, before sparse body trimming.
    crop = (66, 46, 254, 308)
    for group in sorted({key[:-1] for key in paths if key[0] == 1}):
        images = {}
        for key, path in paths.items():
            if key[:-1] == group:
                with Image.open(path) as image:
                    images[key[-1]] = image.copy()
        encoded = {name: encode(image, (320, 352), images['lines'] if name not in ('lines', 'beauty') else None).crop(crop)
                   for name, image in images.items() if name != 'beauty'}
        for scale in (1, 1.37, 2.5):
            for shift in ([0, 0, 0], [150, .4, .15]):
                samples = []
                for y in range(8, 375, 3):
                    for x in range(8, 300, 3):
                        px, py = ((x+.5-20.375)/scale*2-.5, (y+.5-20.125)/scale*2-.5)
                        if px < -.5 or py < -.5 or px > 187.5 or py > 261.5:
                            continue
                        terms = {name: sample(image, px, py) for name, image in encoded.items()}
                        furniture = terms['furniture']
                        if furniture[3] and shift != [0, 0, 0]:
                            straight = [v/furniture[3] for v in furniture[:3]]
                            srgb = [v*12.92 if v <= .0031308 else 1.055*v**(1/2.4)-.055 for v in straight]
                            changed = recolour(srgb, shift)
                            furniture[:3] = [(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4)*furniture[3] for v in changed]
                        total = [sum(term[channel] for term in terms.values()) for channel in range(4)]
                        if .48 < total[3] < .52:
                            continue
                        if total[3] < .5:
                            expected = [23, 23, 28]
                        else:
                            linear = [value/total[3] for value in total[:3]]
                            display = [v*12.92 if v <= .0031308 else 1.055*max(0, v)**(1/2.4)-.055 for v in linear]
                            alpha = min(1, total[3])
                            expected = [round(value*255*alpha+background*(1-alpha)) for value, background in zip(display, (23, 23, 28))]
                        samples.append([x, y, *expected])
                records.append({'facing': group[1], 'palette': group[2], 'scale': scale,
                                'shift': shift, 'samples': samples})
    destination = ROOT/'web/proofs/.covered-bunk-reference.json'
    destination.write_text(json.dumps({'source_receipt': proof['signature']['source_sha256'], 'records': records}))
    print('Prepared', len(records), 'cases from original full owner renders')


if __name__ == '__main__':
    run()
