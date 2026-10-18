"""Export the approved logo and flower without regenerating their shapes."""
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/branding/approved-logo-pair.png'
PUBLIC = ROOT / 'web/public'
BRAND = PUBLIC / 'branding'


def foreground(panel):
    """Remove the dark review background and unblend its antialiased edges."""
    pixels = panel.load()
    background = panel.getpixel((panel.width - 20, 20))
    mask = Image.new('L', panel.size)
    mask.putdata([255 if max(abs(c - b) for c, b in zip(pixels[x,y], background)) > 12 else 0
                  for y in range(panel.height) for x in range(panel.width)])
    solid = mask.filter(ImageFilter.MinFilter(3))
    result = Image.new('RGBA', panel.size)
    for y in range(panel.height):
        for x in range(panel.width):
            if not mask.getpixel((x, y)):
                continue
            color = pixels[x, y]
            if solid.getpixel((x, y)):
                result.putpixel((x, y), (*color, 255))
                continue
            neighbors = [(dx*dx + dy*dy, pixels[x+dx, y+dy])
                         for dy in range(-3, 4) for dx in range(-3, 4)
                         if 0 <= x+dx < panel.width and 0 <= y+dy < panel.height
                         and solid.getpixel((x+dx, y+dy))]
            if not neighbors:
                continue
            neighbor = min(neighbors, key=lambda item: item[0])[1]
            direction = [f-b for f, b in zip(neighbor, background)]
            denominator = sum(v*v for v in direction)
            alpha = max(0, min(1, sum((c-b)*v for c, b, v in
                                     zip(color, background, direction)) / denominator))
            if alpha > 0:
                rgb = [round(max(0, min(255, (c-(1-alpha)*b)/alpha)))
                       for c, b in zip(color, background)]
                result.putpixel((x, y), (*rgb, round(alpha*255)))
    return result


def flower_mask(logo):
    """Keep connected artwork containing sage green; lettering is separate."""
    pixels = logo.load()
    visited = set()
    result = Image.new('L', logo.size)
    for y in range(logo.height):
        for x in range(logo.width):
            if (x, y) in visited or pixels[x, y][3] < 16:
                continue
            component = []
            green_pixels = 0
            queue = deque([(x, y)])
            visited.add((x, y))
            while queue:
                px, py = queue.popleft()
                component.append((px, py))
                r, g, b, _ = pixels[px, py]
                green_pixels += g > r + 3 and g > b + 8 and g < 195
                for nx, ny in ((px-1, py), (px+1, py), (px, py-1), (px, py+1)):
                    if (0 <= nx < logo.width and 0 <= ny < logo.height
                            and (nx, ny) not in visited and pixels[nx, ny][3] >= 16):
                        visited.add((nx, ny))
                        queue.append((nx, ny))
            if green_pixels > 100:
                for point in component:
                    result.putpixel(point, 255)
    return result.filter(ImageFilter.MaxFilter(7))


def export():
    BRAND.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert('RGB')
    # The dark panel separates even the pale petal edges from its background.
    panel = source.crop((source.width//2 + 4, 60, source.width - 40, 670))
    dark = foreground(panel)
    bounds = dark.getbbox()
    assert bounds is not None
    dark = dark.crop(bounds)
    emblem_mask = flower_mask(dark)
    assert emblem_mask.getbbox() is not None
    light = dark.copy()
    for y in range(dark.height):
        for x in range(dark.width):
            r, g, b, a = dark.getpixel((x, y))
            if not a:
                continue
            if not emblem_mask.getpixel((x, y)):
                light.putpixel((x, y), (53, 33, 47, a))
            elif g > r + 3 and g > b + 8 and g < 195:
                light.putpixel((x, y), (max(0,r-40), max(0,g-40), max(0,b-35), a))
    dark.save(BRAND / 'logo-dark.png', optimize=True)
    light.save(BRAND / 'logo-light.png', optimize=True)
    flower = dark.copy()
    for y in range(dark.height):
        for x in range(dark.width):
            if not emblem_mask.getpixel((x,y)):
                flower.putpixel((x,y), (0,0,0,0))
    flower = flower.crop(flower.getbbox())
    flower.save(BRAND / 'flower.png', optimize=True)
    icon = Image.new('RGBA', (1024,1024), '#11161d')
    scale = min(820/flower.width, 820/flower.height)
    art = flower.resize((round(flower.width*scale), round(flower.height*scale)), Image.Resampling.LANCZOS)
    icon.alpha_composite(art, ((1024-art.width)//2,(1024-art.height)//2))
    ink = ImageChops.difference(icon.convert('RGB'), Image.new('RGB',icon.size,'#11161d')).getbbox()
    assert ink is not None and max(ink[2]-ink[0],ink[3]-ink[1]) >= 800, 'Icon artwork is too small'
    for size in (192,512,1024):
        icon.resize((size,size), Image.Resampling.LANCZOS).save(BRAND / f'icon-{size}.png', optimize=True)
    icon.resize((180,180), Image.Resampling.LANCZOS).save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    icon.save(PUBLIC / 'favicon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])
    # A local review sheet includes actual small-icon sizes and both themes.
    sheet = Image.new('RGB', (1000,580), '#f2f5f8')
    ImageDraw.Draw(sheet).rectangle((500,0,1000,580), fill='#11161d')
    for logo, x in ((light,25),(dark,525)):
        preview = logo.copy()
        preview.thumbnail((450,290), Image.Resampling.LANCZOS)
        sheet.paste(preview,(x,30),preview)
        for size, offset in ((16,0),(32,45),(64,110),(128,205)):
            small = icon.resize((size,size),Image.Resampling.LANCZOS)
            sheet.paste(small,(x+offset,370),small)
    review = ROOT / '.scratch/branding'
    review.mkdir(parents=True,exist_ok=True)
    sheet.save(review / 'exports.png')
    print(f'Logo: {dark.width} x {dark.height}; flower: {flower.width} x {flower.height}')


if __name__ == '__main__':
    export()
