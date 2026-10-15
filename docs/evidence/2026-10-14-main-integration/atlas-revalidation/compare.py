"""Read-only atlas repacking proof; writes only its adjacent evidence receipt."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import re
import subprocess
import tomllib

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).with_name('comparison.json')
OLD = '622a0c4b27448b0d5bf1e00c75924ccd5b34a69b'
BASE = ROOT / 'assets/models/sims/character-repair'
BUNDLES = ['fixture-depth', 'aquarium-depth', 'shelf-depth', 'components', 'dropped-book']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git_bytes(path):
    return subprocess.check_output(['git', 'show', OLD + ':' + path], cwd=ROOT)


def exported_table(text, name):
    section = re.search(r'export const ' + name + r'[^\n]* = \{(.*?)\n\};', text, re.S).group(1)
    return {int(match.group(1)): json.loads(match.group(2).rstrip(','))
            for line in section.splitlines()
            if (match := re.match(r'\s*(\d+): (.*)', line))}


def rect(row):
    return [row[key] for key in ('x', 'y', 'w', 'h')]


def region(image, row):
    return image.crop((row['x'], row['y'], row['x'] + row['w'], row['y'] + row['h'])).tobytes()


def main(report):
    old_bytes = git_bytes('assets/sprites/atlas.toml')
    new_bytes = (ROOT / 'assets/sprites/atlas.toml').read_bytes()
    old, new = tomllib.loads(old_bytes.decode()), tomllib.loads(new_bytes.decode())
    manifests = {folder: json.loads((BASE / folder / 'manifest.json').read_text()) for folder in BUNDLES}
    dependencies = {}
    for folder, manifest in manifests.items():
        rows = manifest.get('sprites', manifest.get('states', list(manifest.get('facings', {}).values())))
        for row in rows:
            dependencies.setdefault(row['atlasIndex'], []).append((folder, row))
    report.update(oldCommit=OLD, currentCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  oldAtlasSha256=sha(old_bytes), currentAtlasSha256=sha(new_bytes), dependentSpriteCount=len(dependencies))
    old_ts, new_ts = git_bytes('web/src/render/atlas.ts').decode(), (ROOT / 'web/src/render/atlas.ts').read_text()
    tables = {}
    for name in ['SPRITE_ANCHORS', 'SPRITE_CONTENT_BOUNDS', 'SPRITE_CONTENT_TOPS']:
        before, after = exported_table(old_ts, name), exported_table(new_ts, name)
        assert all(before.get(index) == after.get(index) for index in dependencies), name
        tables[name] = before
    report['anchorTablesEqual'] = list(tables)
    del old_ts, new_ts

    companion_pages = []
    for folder, manifest in manifests.items():
        pages = manifest.get('pages', manifest.get('colorPages', []) + manifest.get('depthPages', []))
        for page in pages:
            path = BASE / folder / page['path']
            digest = file_sha(path)
            assert digest == page['sha256'], str(path)
            assert path.stat().st_size == page['width'] * page['height'] * 4
            companion_pages.append(dict(path=path.relative_to(ROOT).as_posix(), expected=page['sha256'], before=digest))
    report['companionPages'] = companion_pages

    entries, changed, verified_pages = [], [], {}
    for index, owners in sorted(dependencies.items()):
        before, after = old['sprite'][index], new['sprite'][index]
        assert {k: v for k, v in before.items() if k not in ('x', 'y', 'page')} == {k: v for k, v in after.items() if k not in ('x', 'y', 'page')}
        old_page, new_page = old['pages'][before.get('page', 0)], new['pages'][after.get('page', 0)]
        entry = dict(index=index, name=before['name'], bundles=sorted(set(folder for folder, _ in owners)),
                     oldPage=old_page, currentPage=new_page, oldRect=rect(before), currentRect=rect(after),
                     density=before.get('pixel_density', 1), anchor=tables['SPRITE_ANCHORS'].get(index))
        if old_page == new_page and rect(before) == rect(after):
            if old_page not in verified_pages:
                original = git_bytes('web/public/' + old_page)
                digest = sha(original)
                assert digest == file_sha(ROOT / 'web/public' / new_page)
                assert digest == old_page.removeprefix('atlas-').removesuffix('.png')
                verified_pages[old_page] = digest
                del original
            entry.update(equal=True, method='identical-full-page-sha256-and-rectangle', pageSha256=verified_pages[old_page])
        else:
            changed.append(index)
        entries.append(entry)
    report['sprites'] = entries
    report['unchangedPageDigests'] = verified_pages

    old_crops, decoded = {}, {'old': [], 'current': []}
    for page_name in sorted({old['pages'][old['sprite'][i].get('page', 0)] for i in changed}):
        data = git_bytes('web/public/' + page_name)
        assert sha(data) == page_name.removeprefix('atlas-').removesuffix('.png')
        with Image.open(BytesIO(data)) as image:
            with image.convert('RGBA') as rgba:
                for index in changed:
                    row = old['sprite'][index]
                    if old['pages'][row.get('page', 0)] == page_name:
                        old_crops[index] = region(rgba, row)
        decoded['old'].append(page_name)
        del data
    by_index = {entry['index']: entry for entry in entries}
    alpha_checks = []
    for page_name in sorted({new['pages'][new['sprite'][i].get('page', 0)] for i in changed}):
        source = ROOT / 'web/public' / page_name
        assert file_sha(source) == page_name.removeprefix('atlas-').removesuffix('.png')
        with Image.open(source) as image:
            with image.convert('RGBA') as rgba:
                for index in changed:
                    row = new['sprite'][index]
                    if new['pages'][row.get('page', 0)] != page_name:
                        continue
                    current = region(rgba, row)
                    assert old_crops[index] == current, row['name'] + ': RGBA differs'
                    by_index[index].update(equal=True, method='exact-decoded-rgba', oldCropSha256=sha(old_crops[index]), currentCropSha256=sha(current))
                    alpha = np.frombuffer(current, dtype=np.uint8).reshape(row['h'], row['w'], 4)[:, :, 3]
                    for folder, companion in dependencies[index]:
                        manifest = manifests[folder]
                        if folder in ('fixture-depth', 'aquarium-depth'):
                            target, pages, offset = companion, manifest['pages'], (0, 0)
                        elif folder == 'dropped-book':
                            target, pages = companion['depth'], manifest['depthPages']
                            offset = tuple(int(value * companion['pixelDensity']) for value in companion['anchorOffset'])
                        else:
                            raise AssertionError('Unexpected changed bundle ' + folder)
                        page = pages[target['pageIndex']]
                        pixels = np.memmap(BASE / folder / page['path'], mode='r', dtype=np.uint8, shape=(page['height'], page['width'], 4))
                        x, y = target['x'] + offset[0], target['y'] + offset[1]
                        companion_alpha = pixels[y:y + row['h'], x:x + row['w'], 3]
                        assert np.array_equal(alpha > 0, companion_alpha > 0), row['name'] + ': companion alpha differs'
                        alpha_checks.append(dict(index=index, name=row['name'], bundle=folder, nonzeroAlphaEqual=True,
                                                 coveredPixels=int(np.count_nonzero(alpha)), companionPage=page['path']))
                        del companion_alpha, pixels
        decoded['current'].append(page_name)
    report.update(decodedPages=decoded, changedCropCount=len(changed), companionAlphaChecks=alpha_checks,
                  alphaScope='Direct alpha comparison covers all 25 changed crops. The remaining 159 source crops are proved unchanged by complete page hashes and identical coordinates; this run does not repeat their prior companion-alpha validation.')
    for record in companion_pages:
        record['after'] = file_sha(ROOT / record['path'])
        assert record['after'] == record['before'] == record['expected']
    assert file_sha(ROOT / 'assets/sprites/atlas.toml') == report['currentAtlasSha256']
    for folder, manifest in manifests.items():
        assert json.loads((BASE / folder / 'manifest.json').read_text()) == manifest
    report['manifestsUnchanged'] = True
    report['status'] = 'PASS'


if __name__ == '__main__':
    if OUT.exists():
        raise RuntimeError('Comparison receipt already exists')
    report = {'status': 'RUNNING', 'date': '2026-10-14'}
    try:
        main(report)
    except Exception as error:
        report.update(status='FAIL', error=repr(error))
        raise
    finally:
        OUT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({key: report[key] for key in ['status', 'dependentSpriteCount', 'changedCropCount'] if key in report}))
