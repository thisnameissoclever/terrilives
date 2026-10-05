"""Decode current or historical sprite pages without changing their RGBA bytes."""
import io
from pathlib import Path
import tomllib

from PIL import Image


class AtlasPages:
    def __init__(self, root, *, manifest=None, read_bytes=None):
        self.root = Path(root)
        self.read_bytes = read_bytes or (lambda path: path.read_bytes())
        self.manifest = manifest if manifest is not None else tomllib.loads(
            self.read_bytes(self.root/'assets/sprites/atlas.toml').decode())
        self.files = self.manifest.get('pages', [self.manifest.get('image', 'atlas.png')])
        if not isinstance(self.files, list) or not self.files:
            raise ValueError('Atlas has no page inventory')
        self.cache = {}

    def page(self, index):
        if type(index) is not int or not 0 <= index < len(self.files):
            raise ValueError('Atlas page index is out of range')
        if index not in self.cache:
            public = (self.root/'web/public').resolve()
            path = (public/self.files[index]).resolve()
            if not path.is_relative_to(public):
                raise ValueError('Atlas page leaves its public directory')
            image = Image.open(io.BytesIO(self.read_bytes(path)))
            image.load()
            if image.mode != 'RGBA' or image.size != (self.manifest['width'], self.manifest['height']):
                image.close()
                raise ValueError('Atlas page mode or dimensions differ')
            self.cache[index] = image
        return self.cache[index]

    def crop(self, row):
        image = self.page(row.get('page', 0))
        x, y, width, height = (row[key] for key in ('x', 'y', 'w', 'h'))
        if (any(type(v) is not int for v in (x, y, width, height)) or x < 0 or y < 0
                or width <= 0 or height <= 0 or x+width > image.width or y+height > image.height):
            raise ValueError('Sprite rectangle leaves its atlas page')
        return image.crop((x, y, x+width, y+height))

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        for image in self.cache.values():
            image.close()
        self.cache.clear()
