import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { FLOATS_PER_INSTANCE, OFFSET_PROJECTION_ANCHOR_X, writeInstance } from '../src/render/instances.ts';
import { writeFootprintProjection } from '../src/render/footprint-depth.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { layeredDepth, LAYER_PROP } from '../src/render/iso.ts';

// Bracket the actual shader's depth with an independently derived ray-box
// interval. Shifted registration deliberately exercises noncentral canvases.
export async function footprintDepthProof() {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 440;
    const gpu = await initDevice(canvas);
    gpu.device.pushErrorScope('validation');
    const renderer = await SpriteRenderer.create(gpu);
    const step = layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP);
    const floor = spriteIndex('floor'), results = [];
    const sample = async (rows, count, px, scale) => {
        renderer.draw(rows, count, scale);
        await gpu.device.queue.onSubmittedWorkDone();
        const copy = document.createElement('canvas');
        copy.width = 400; copy.height = 440;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        return [...ctx.getImageData(px, 300, 1, 1).data];
    };
    try {
        for (const scale of [1, 1.75, 3])
            for (const [width, depth] of [[2, 1], [1, 2], [3, 1], [1, 3]])
                for (const anchor of [-16, 0, 16])
                    for (const column of [-24, -8, 0, 8, 24]) {
                        const t = (column + anchor) / 32;
                        const low = Math.max(-width - t, -depth + t);
                        const high = Math.min(width - t, depth + t);
                        const expected = 0.5 - (low + high) / 2 * step;
                        const px = 200 + column * scale;
                        const marker = new Float32Array(FLOATS_PER_INSTANCE);
                        writeInstance(marker, 0, px + 0.5, 300.5, expected, floor, 1, 0, 1);
                        const markerPixel = await sample(marker, 1, px, scale);
                        const rows = new Float32Array(2 * FLOATS_PER_INSTANCE);
                        writeInstance(rows, 0, 200.5, 300.5, 0.5, floor);
                        writeFootprintProjection(rows, 0, width, depth, floor, 16);
                        rows[OFFSET_PROJECTION_ANCHOR_X] = anchor;
                        let pass = true;
                        for (const [delta, markerWins] of [[-0.01, true], [0.01, false]]) {
                            writeInstance(rows, 1, px + 0.5, 300.5, expected + delta * step, floor, 1, 0, 1);
                            const pixel = await sample(rows, 2, px, scale);
                            pass &&= pixel.every((v, c) => v === markerPixel[c]) === markerWins;
                        }
                        results.push({ scale, width, depth, anchor, column, pass });
                    }
        const error = await gpu.device.popErrorScope();
        return { pass: !error && results.length === 180 && results.every(r => r.pass), error: error?.message ?? null, results };
    } finally {
        gpu.device.destroy();
    }
}
