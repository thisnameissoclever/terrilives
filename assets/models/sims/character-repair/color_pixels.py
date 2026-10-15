"""Read display-encoded PNG bytes without Blender's image color conversion."""
from pathlib import Path
import sys
from PIL import Image


if __name__ == '__main__':
    mode, source, output, *values = sys.argv[1:]
    if mode == 'mask':
        source_width, source_height, width, height = map(int, values)
        image = Image.frombytes('L', (source_width, source_height), Path(source).read_bytes())
        Path(output).write_bytes(image.resize((width, height), Image.Resampling.LANCZOS).tobytes())
        sys.exit(0)
    with Image.open(source) as image:
        image = image.convert('RGBA')
        numbers = [int(value) for value in values]
        if mode == 'resize':
            image = image.resize(tuple(numbers), Image.Resampling.LANCZOS)
        elif mode == 'crop':
            x, y, width, height = numbers
            image = image.crop((x, y, x + width, y + height))
        else:
            raise ValueError('Unknown pixel operation')
        Path(output).write_bytes(image.tobytes())

