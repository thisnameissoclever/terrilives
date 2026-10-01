import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path('.')
export = root / 'assets/models/bedroom/export/double-bed-covered'
manifest = json.loads((export / 'manifest.json').read_text())
output = root / 'web/proofs/.covered-bed-reference.json'
def to_linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
def to_srgb(rgb):
    return np.where(rgb <= .0031308, rgb * 12.92, 1.055 * np.maximum(rgb, 0) ** (1 / 2.4) - .055)
def recolour(rgb, shift):
    linear = to_linear(rgb)
    lms = np.cbrt(linear @ np.array([[.4122214708,.5363325363,.0514459929], [.2119034982,.6806995451,.1073969566], [.0883024619,.2817188376,.6299787005]]).T)
    lab = lms @ np.array([[.2104542553,.7936177850,-.0040720468], [1.9779984951,-2.4285922050,.4505937099], [.0259040371,.7827717662,-.8086757660]]).T
    angle = np.radians(shift[0]); c, s = np.cos(angle), np.sin(angle)
    a, b = lab[..., 1].copy(), lab[..., 2].copy()
    lab[..., 1] = (c * a - s * b) * (1 + shift[1]); lab[..., 2] = (s * a + c * b) * (1 + shift[1])
    lab[..., 0] = np.clip(lab[..., 0] + shift[2], 0, 1)
    lms = lab @ np.array([[1,.3963377774,.2158037573], [1,-.1055613458,-.0638541728], [1,-.0894841775,-1.2914855480]]).T
    back = np.clip((lms ** 3) @ np.array([[4.0767416621,-3.3077115913,.2309699292], [-1.2684380046,2.6097574011,-.3413193965], [-.0041960863,-.7034186147,1.7076147010]]).T, 0, 1)
    return to_srgb(back)

points = np.array([(x,y) for y in range(20,175,3) for x in range(20,185,3)])
records = []
for scene in manifest['scenes']:
    refs = [scene['furniture'], *scene['bodies'], scene['outline']]
    arrays = [np.array(Image.open(export/ref['path']), dtype=np.float64) / 255 for ref in refs]
    for scale in [.73,1.37]:
        xy = (points + .5 - [20.375,20.125]) / scale * 2 - .5
        inside = np.logical_and.reduce([xy[:,0] >= -.5, xy[:,0] < 231.5, xy[:,1] >= -.5, xy[:,1] < 217.5])
        xy = np.clip(xy,[0,0],[231,217]); lo = np.floor(xy).astype(int); hi = np.minimum(lo+1,[231,217]); weight = xy-lo
        def sample(array):
            return ((array[lo[:,1],lo[:,0]]*(1-weight[:,0,None]) + array[lo[:,1],hi[:,0]]*weight[:,0,None])*(1-weight[:,1,None])
                    +(array[hi[:,1],lo[:,0]]*(1-weight[:,0,None]) + array[hi[:,1],hi[:,0]]*weight[:,0,None])*weight[:,1,None])
        terms = [sample(array) for array in arrays]
        for shift in [[0,0,0], [150,.4,.15]]:
            furniture = terms[0].copy()
            if any(shift):
                alpha = furniture[:,3,None]
                straight = np.divide(furniture[:,:3], alpha, out=np.zeros_like(furniture[:,:3]), where=alpha>0)
                furniture[:,:3] = to_linear(recolour(to_srgb(straight),shift))*alpha
            summed = furniture + sum(terms[1:])
            alpha = summed[:,3,None]
            straight = np.divide(summed[:,:3], alpha, out=np.zeros_like(summed[:,:3]), where=alpha>0)
            drawn = np.logical_and(inside, summed[:,3]>=.5)
            rgb = np.where(drawn[:,None], to_srgb(straight)*np.minimum(alpha,1) + [.09,.09,.11]*(1-np.minimum(alpha,1)), [.09,.09,.11])
            rgb = np.round(np.clip(rgb,0,1)*255).astype(int)
            # Hardware interpolation quantises weights. Exclude only the discard's ambiguous fringe.
            stable = np.logical_or(~inside, np.abs(summed[:,3]-.5)>.012)
            samples = [[int(x),int(y),*[int(value) for value in colour]] for (x,y), colour in zip(points[stable],rgb[stable])]
            records.append({'facing':scene['facing'],'mask':scene['occupancy'],'palettes':scene['palettes'], 'scale':scale,'shift':shift,'samples':samples})
output.write_text(json.dumps({'manifest': '0c9b1c854d2a74993b1d3e9fb9297e75c4fa5ca59762daa531c363d57acca2cb', 'records':records},separators=(',',':')))
print(f'{len(records)} independent GPU reference cases, {sum(len(r["samples"]) for r in records)} stable pixels')
