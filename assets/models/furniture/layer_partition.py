"""Encode separate visible layers for a single additive pair draw.

These RGBA files contain premultiplied RGB, unlike ordinary atlas sprites.
Their contributions are added and unpremultiplied once before normal blending.
"""
from PIL import Image, ImageChops


def encode_contribution(image, size):
    red, green, blue, alpha = image.convert('RGBA').split()
    bands = [ImageChops.multiply(channel, alpha) for channel in (red, green, blue)] + [alpha]
    # Resizing RGBA would premultiply the already encoded RGB a second time.
    return Image.merge('RGBA', [band.resize(size, Image.Resampling.BOX) for band in bands])


def reconstruct_layers(body, furniture, outline=None):
    if body.size != furniture.size or (outline is not None and outline.size != body.size):
        raise ValueError('Paired layer dimensions differ')
    if outline is None:
        outline = Image.new('RGBA', body.size)
    pixels = []
    for sim, prop, ink in zip(body.getdata(), furniture.getdata(), outline.getdata()):
        alpha = sim[3] + prop[3]
        if alpha > 257:
            raise ValueError('Paired coverage exceeds the complete scene')
        remaining = 1 - ink[3]/255
        alpha = ink[3] + alpha*remaining
        if alpha == 0:
            pixels.append((0, 0, 0, 0))
            continue
        rgb = tuple(min(255, round((ink[i]+(sim[i]+prop[i])*remaining)*255/alpha)) for i in range(3))
        pixels.append((*rgb, min(255, round(alpha))))
    result = Image.new('RGBA', body.size)
    result.putdata(pixels)
    return result
