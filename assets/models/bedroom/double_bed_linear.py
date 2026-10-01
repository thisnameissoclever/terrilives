"""Encode final visible contributions before filtering, in scene-linear color."""
from PIL import Image, ImageMath

LINEAR = [v/255/12.92 if v/255 <= .04045 else ((v/255+.055)/1.055)**2.4 for v in range(256)]
ALPHA = [v/255 for v in range(256)]


def encode(image, size, ink=None):
    if image.mode != 'RGBA' or (ink is not None and ink.size != image.size):
        raise ValueError('Expected registered RGBA sources')
    alpha = image.getchannel('A').point(ALPHA, mode='F')
    if ink is not None:
        ink_alpha = ink.getchannel('A').point(ALPHA, mode='F')
        alpha = ImageMath.lambda_eval(lambda a: a['fill']*(1-a['ink']), fill=alpha, ink=ink_alpha)
    channels = []
    for channel in image.split()[:3]:
        linear = channel.point(LINEAR, mode='F')
        channels.append(ImageMath.lambda_eval(lambda a: a['rgb']*a['alpha'], rgb=linear, alpha=alpha))
    channels.append(alpha)
    return Image.merge('RGBA', [channel.resize(size, Image.Resampling.BOX)
                               .point(lambda v: v*255+.5).convert('L') for channel in channels])


def display(value):
    return value*12.92 if value <= .0031308 else 1.055*max(0, value)**(1/2.4)-.055


def reconstruct(layers):
    if not layers or any(layer.size != layers[0].size for layer in layers):
        raise ValueError('Expected matching visible contributions')
    pixels = []
    for parts in zip(*(image.getdata() for image in layers)):
        alpha = sum(part[3] for part in parts)
        if alpha > 258:
            raise ValueError('Visible owner coverage exceeds the scene')
        if not alpha:
            pixels.append((0, 0, 0, 0))
        else:
            pixels.append(tuple(min(255, round(display(sum(part[i] for part in parts)/alpha)*255))
                                for i in range(3))+(min(255, alpha),))
    result = Image.new('RGBA', layers[0].size)
    result.putdata(pixels)
    return result
