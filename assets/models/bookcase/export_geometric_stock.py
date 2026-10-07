"""Package captured shelf inventories with the ordinary shelf's signed texture format."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np
from PIL import Image

import signed_stock_codec as codec

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'assets/sprites/gen'))
from atlas_pages import pack_pages


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def verify_capture(row, index_path, proof_path, proof):
    matches = [render for render in proof['renders']
               if render.get('stock_mask') == row['mask'] and render.get('palette') == row['palette']]
    if (not proof.get('inputs_unchanged') or row['facing'] != proof['facing']
            or row['density'] != proof['density'] or len(matches) != 1):
        raise ValueError('Shelf capture identity or registration differs from its renderer')
    render = matches[0]
    source = row.get('sourceRender', row)
    source_path = (index_path.parent / source['path']).resolve()
    if (source_path != (proof_path.parent / render['path']).resolve()
            or source['sha256'] != render['sha256']
            or render.get('owner_visibility', {}).get('actor_collection_hidden') is not True):
        raise ValueError('Shelf capture does not match its actor-free renderer output')
    crop = row.get('sourceCrop')
    if crop is None:
        if row.get('sourceRender') or any(row[field] != proof[field] for field in ('canvas', 'anchor')):
            raise ValueError('Shelf capture registration differs')
        return
    density = row['density']
    size = [value * density for value in proof['canvas']]
    if (not isinstance(crop, list) or len(crop) != 4 or any(type(value) is not int for value in crop)
            or not 0 <= crop[0] < crop[2] <= size[0] or not 0 <= crop[1] < crop[3] <= size[1]
            or [crop[2] - crop[0], crop[3] - crop[1]] != [value * density for value in row['canvas']]
            or any(abs(row['anchor'][axis] - (proof['anchor'][axis] - crop[axis] / density)) > .0001
                   for axis in range(2)) or digest(source_path) != source['sha256']):
        raise ValueError('Shelf source crop does not preserve registered samples')
    with Image.open(source_path) as original, Image.open(index_path.parent / row['path']) as cropped:
        if (original.mode != 'RGBA' or cropped.mode != 'RGBA' or original.size != tuple(size)
                or original.crop(crop).tobytes() != cropped.tobytes()
                or cropped.size != (crop[2] - crop[0], crop[3] - crop[1])):
            raise ValueError('Shelf cropped pixels differ from the actual expanded render')


def export(index_path, output):
    started = time.monotonic()
    source = json.loads(index_path.read_text(encoding='utf-8'))
    if source['state'] != 'complete_actual_static_source' or output.exists():
        raise ValueError('Require completed captures and a fresh export directory')
    output.mkdir(parents=True)
    (output / 'sources').mkdir()
    (output / 'provenance').mkdir()
    shutil.copyfile(index_path, output / 'provenance/source-index.json')
    writers = {}
    for writer in source['sourceWriters']:
        proof_path, receipt_path = Path(writer['proof']), Path(writer['receipt'])
        if digest(proof_path) != writer['proofSHA256'] or digest(receipt_path) != writer['receiptSHA256']:
            raise ValueError('Source writer evidence changed')
        proof = json.loads(proof_path.read_text())
        receipt = json.loads(receipt_path.read_text(encoding='utf-8-sig'))
        if (proof['state'] != 'complete' or not proof.get('inputs_unchanged') or receipt['exit_code'] != 0
                or receipt['writer_pid'] != proof['pid'] or not receipt['actual_handle_retained']
                or not receipt['inputs_unchanged']):
            raise ValueError('Source renderer did not complete with unchanged inputs')
        if writer['facing'] in writers or proof['facing'] != writer['facing']:
            raise ValueError('Shelf source writer facing is duplicated or mismatched')
        writers[writer['facing']] = (proof_path, proof)
        for label, path in [('proof', proof_path), ('exit', receipt_path)]:
            shutil.copyfile(path, output / 'provenance' / f'{writer["facing"]}-{label}.json')
    captures = []
    for row in source['captures']:
        verify_capture(row, index_path, *writers[row['facing']])
        path = index_path.parent / row['path']
        if digest(path) != row['sha256']:
            raise ValueError('Captured shelf pixels changed')
        copied = output / 'sources' / f'{row["facing"]}-{row["mask"]:06x}.png'
        shutil.copyfile(path, copied)
        derived = dict(row)
        if 'sourceRender' in row:
            full_path = index_path.parent / row['sourceRender']['path']
            full_copy = output / 'provenance' / f'{row["facing"]}-{row["mask"]:06x}-expanded.png'
            shutil.copyfile(full_path, full_copy)
            derived['sourceRender'] = dict(row['sourceRender'], path=full_copy.relative_to(output).as_posix())
        captures.append(dict(derived, path=copied.relative_to(output).as_posix(),
                             reuse=dict(path=copied.relative_to(ROOT).as_posix(), sha256=row['sha256'])))
    manifest = dict(state='complete', registration=source['registration'], slot_transforms=source['slot_transforms'],
                    source_captures=captures, bases={}, rows={}, images=[], pages=[],
                    source_proof_sha256=digest(index_path),
                    inputs={Path(__file__).relative_to(ROOT).as_posix(): digest(__file__),
                            'assets/models/bookcase/signed_stock_codec.py': digest(Path(codec.__file__)),
                            'assets/sprites/gen/atlas_pages.py': digest(ROOT / 'assets/sprites/gen/atlas_pages.py')},
                    encoding='legacy-srgb-signed16', actual_gpu_executed=False,
                    all_mask_claim='Finite source captures; no exhaustive 24-bit inventory claim')
    metrics = []

    def write(key, pixels, registration):
        path = output / f'{key}.png'
        Image.fromarray(pixels).save(path)
        manifest['images'].append(dict(key=key, path=path.name, sha256=digest(path),
                                       size=[pixels.shape[1], pixels.shape[0]], decoded_bytes=pixels.nbytes,
                                       registration=registration))
        return key

    for facing in ('SE', 'NW', 'SW', 'NE'):
        records = [row for row in captures if row['facing'] == facing]
        by_mask = {row['mask']: row for row in records}
        expected_masks = {0} | {state << (row * 6) for row in range(4) for state in range(1, 64)}
        if not expected_masks.issubset(by_mask) or len(by_mask) != len(records):
            raise ValueError('Shelf source states are incomplete or duplicated')
        with Image.open(output / by_mask[0]['path']) as image:
            base_raw = np.asarray(image.convert('RGBA')).copy()
            base, base8, _ = codec.legacy_precision(image.convert('RGBA'))
        manifest['bases'][facing] = write(f'{facing}-base', base8, [0, 0])
        states, decoded_rows = [], []
        for row in range(4):
            local = [dict(state=0, high=None, low=None, rect=None)]
            decoded = [np.zeros_like(base)]
            for state in range(1, 64):
                record = by_mask[state << (row * 6)]
                with Image.open(output / record['path']) as image:
                    rgba = image.convert('RGBA')
                    if not np.array_equal(np.asarray(rgba)[:, :, 3], base_raw[:, :, 3]):
                        raise ValueError(f'{record["key"]}: stock changes source transparency')
                    precise, legacy, _ = codec.legacy_precision(rgba)
                if not np.array_equal(legacy[:, :, 3], base8[:, :, 3]):
                    raise ValueError('Stock changes filtered transparency')
                high, low = codec.encode(precise - base)
                decoded.append(codec.decode(high / np.float32(255), low / np.float32(255)))
                crop = codec.crop_encoded(high, low)
                if crop is None:
                    local.append(dict(state=state, high=None, low=None, rect=None))
                else:
                    rect, high, low = crop
                    local.append(dict(state=state, rect=rect,
                                      high=write(record['key'] + '-high', high, [rect[0] / 2, rect[1] / 2]),
                                      low=write(record['key'] + '-low', low, [rect[0] / 2, rect[1] / 2])))
            states.append(local)
            decoded_rows.append(decoded)
        manifest['rows'][facing] = states
        for record in records:
            with Image.open(output / record['path']) as image:
                rgba = image.convert('RGBA')
                if not np.array_equal(np.asarray(rgba)[:, :, 3], base_raw[:, :, 3]):
                    raise ValueError('Held-out inventory changes shelf transparency')
                expected = np.asarray(rgba.resize(codec.TARGET_SIZE, Image.Resampling.LANCZOS), dtype=np.float32)
            actual = base8[:, :, :3].astype(np.float32) / 255
            for row in range(4):
                actual = actual + decoded_rows[row][(record['mask'] >> (row * 6)) & 63]
            error = np.abs(np.clip(actual, 0, 1) * 255 - expected[:, :, :3]) * (expected[:, :, 3:4] / 255)
            active = error[error > .01]
            metric = dict(key=record['key'], role=record['role'], max=float(error.max()),
                          p95=float(np.quantile(active, .95)) if active.size else 0.0)
            metrics.append(metric)
            if metric['max'] > 6 or metric['p95'] > 2:
                write_json(output / 'rejected-comparison.json', metric)
                raise ValueError(f'Shelf reconstruction failed: {metric}')
        print(f'{facing}: shelf source and encoded comparisons passed', flush=True)

    images = manifest['images']
    placed, count = pack_pages([tuple(row['size']) for row in images], 2048, 1)
    for index, row in enumerate(images):
        page, x, y = placed[index]
        row['packed'] = dict(page=page, x=x, y=y, width=row['size'][0], height=row['size'][1])
    for page in range(count):
        sheet = Image.new('RGBA', (2048, 2048))
        for row in images:
            packed = row['packed']
            if packed['page'] == page:
                with Image.open(output / row['path']) as image:
                    sheet.paste(image, (packed['x'], packed['y']))
        path = output / f'page-{page:02d}.png'
        sheet.save(path)
        manifest['pages'].append(dict(path=path.name, sha256=digest(path), size=[2048, 2048], decoded_bytes=2048 * 2048 * 4))
    manifest['packing'] = dict(page_size=2048, padding=1, shelf_only_pages=count,
                               crop_payload_bytes=sum(row['decoded_bytes'] for row in images), gpu_texture_bytes=count * 2048 * 2048 * 4)
    manifest['images'] = images + manifest['pages']
    manifest['elapsed_seconds'] = time.monotonic() - started
    write_json(output / 'manifest.json', manifest)
    write_json(output / 'cpu-proof.json', dict(**{'pass': True}, pid=os.getpid(), state='complete',
               export_manifest_sha256=digest(output / 'manifest.json'), comparisons=metrics,
               maximum=max(row['max'] for row in metrics), maximum_p95=max(row['p95'] for row in metrics),
               source_input_sha256=digest(index_path), actual_gpu_executed=False))
    print(json.dumps(dict(state='complete', pid=os.getpid(), pages=count, comparisons=len(metrics), seconds=manifest['elapsed_seconds'])), flush=True)


if __name__ == '__main__':
    export(*(Path(value).resolve() for value in sys.argv[1:]))
