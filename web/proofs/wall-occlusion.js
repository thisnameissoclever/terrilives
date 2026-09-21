// Run through Vite in a real WebGPU browser. No mocked rendering.
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer, atlasTextureUrl } from '../src/render/sprites.ts';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { layeredDepth, LAYER_PROP, LAYER_SIM } from '../src/render/iso.ts';
import { simBodySprite, VISUAL_ACTION_WALK } from '../src/frame.ts';
import { spriteIndex, SPRITES } from '../src/render/atlas.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.ts';
export async function wallOcclusionProof({ show = false, flatWalls = false } = {}) {
    const atlas = await createImageBitmap(await (await fetch(atlasTextureUrl('/'))).blob());
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 440;
    const gpu = await initDevice(canvas);
    gpu.device.pushErrorScope('validation');
    const renderer = await SpriteRenderer.create(gpu);
    const board = document.createElement('div');
    if (show) {
        document.querySelector('#wall-proof')?.remove();
        board.id = 'wall-proof';
        board.style = 'position:fixed;inset:0;z-index:999999;overflow:auto;background:#17171c;display:flex;flex-wrap:wrap;color:white';
        document.body.append(board);
    }
    const results = [];
    try {
        for (const scale of [1, 1.75, 3]) {
            for (const [name, x, y, wallX, behind, axis = 0] of [
                ['offlineLaundry', 12, 11, 12, false],
                ['offlineToilet', 12, 6, 12, false],
                ['chairDeskNW', 6, 7, 6, false],
                ['offlineLaundry', 12, 9, 12, false],
                ['offlineLaundry', 11, 10, 12, true],
                ['offlineLaundrySW', 9, 6, 6, false, 1],
                ['offlineLaundrySW', 10, 5, 6, true, 1],
            ]) {
                const ox = 200 - (x - y) * 32 * scale;
                const oy = 360 - (x + y) * 21 * scale;
                const edges = [];
                for (let row = 6; row < 12; row++)
                    edges.push(axis, axis === 0 ? wallX : row, axis === 0 ? row : wallX, 0);
                const geometry = buildStaticInstances({ width: 16, height: 12, walls: new Uint32Array(), edges: Uint32Array.from(edges) }, ox, oy, 16, scale);
                const all = geometry.instances.slice(0, geometry.count * FLOATS_PER_INSTANCE);
                if (flatWalls)
                    for (let n = geometry.floorCount; n < geometry.count; n++)
                        all[n * FLOATS_PER_INSTANCE + 8] = 0;
                const id = spriteIndex(name), sprite = SPRITES[id], density = sprite.pixel_density ?? 1;
                const dx = spriteDrawOffsetX(id), dy = spriteDrawOffsetY(id);
                const prop = new Float32Array(FLOATS_PER_INSTANCE);
                writeInstance(prop, 0, 200 + dx * scale, 360 + dy * scale, layeredDepth(x, y, 16, LAYER_PROP), id);
                const capture = async (count) => {
                    renderer.setStaticGeometry(all, count);
                    renderer.draw(prop, 1, scale);
                    await gpu.device.queue.onSubmittedWorkDone();
                    const copy = document.createElement('canvas');
                    copy.width = canvas.width;
                    copy.height = canvas.height;
                    const ctx = copy.getContext('2d');
                    ctx.drawImage(canvas, 0, 0);
                    return { copy, pixels: ctx.getImageData(0, 0, copy.width, copy.height).data };
                };
                const alone = await capture(geometry.floorCount);
                const together = await capture(geometry.count);
                const mask = document.createElement('canvas');
                mask.width = 400;
                mask.height = 440;
                const mc = mask.getContext('2d');
                mc.drawImage(atlas, sprite.x, sprite.y, sprite.w, sprite.h, 200 + (dx - sprite.w / density / 2) * scale, 360 + (dy + 21 - sprite.h / density) * scale, sprite.w / density * scale, sprite.h / density * scale);
                const alpha = mc.getImageData(0, 0, 400, 440).data;
                let opaque = 0, lost = 0;
                for (let py = 2; py < 438; py++)
                    for (let px = 2; px < 398; px++) {
                        const offset = (py * 400 + px) * 4;
                        // Erode two pixels so filtering and background blending cannot count as clipping.
                        if ([-2, -1, 0, 1, 2].some(d => alpha[offset + d * 4 + 3] !== 255 || alpha[offset + d * 400 * 4 + 3] !== 255))
                            continue;
                        opaque++;
                        if ([0, 1, 2].some(c => Math.abs(alone.pixels[offset + c] - together.pixels[offset + c]) > 3))
                            lost++;
                    }
                const pass = opaque > 100 && (behind ? lost > opaque * 0.25 : lost === 0);
                results.push({ name, x, y, scale, behind, opaque, lost, pass });
                if (show && scale === 3) {
                    const section = document.createElement('section');
                    section.append(`${name} ${behind ? 'behind wall' : 'in front'}: ${lost}/${opaque} hidden`, together.copy);
                    board.append(section);
                }
            }
        }
        const error = await gpu.device.popErrorScope();
        return { pass: !error && results.every(r => r.pass), error: error?.message ?? null, results };
    }
    finally {
        atlas.close();
        gpu.device.destroy();
    }
}
// A coloured floor marker brackets known wall depths. Draw order stays fixed;
// only marker depth changes. The upper samples expose far arms at T joins.
export async function wallJoinDepthProof() {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 440;
    const gpu = await initDevice(canvas);
    gpu.device.pushErrorScope('validation');
    const renderer = await SpriteRenderer.create(gpu);
    const step = layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP);
    const results = [];
    const sample = async (rows, count, x, y, scale) => {
        renderer.draw(rows, count, scale);
        await gpu.device.queue.onSubmittedWorkDone();
        const copy = document.createElement('canvas');
        copy.width = 400;
        copy.height = 440;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        return [...ctx.getImageData(x, y, 1, 1).data];
    };
    try {
        for (const scale of [1, 1.75, 3])
            for (const mask of [3, 6, 7, 9, 11, 12, 13, 14, 15]) {
                for (const [x, near, far] of [[-15, 4, 8], [15, 2, 1]]) {
                    for (const [y, isNear] of [[-75, false], [-67, true], [-50, Boolean(mask & near)]]) {
                        if (isNear ? !(mask & near) : !(mask & far))
                            continue;
                        const px = Math.floor(200 + (x + 0.5) * scale), py = Math.floor(300 + (y - 0.5) * scale);
                        const expected = 0.5 - (isNear ? 1 : -1) * Math.abs(x) / 32 * step;
                        const marker = new Float32Array(FLOATS_PER_INSTANCE);
                        writeInstance(marker, 0, px, py, expected, spriteIndex('floor'), 1, 0, 1);
                        const markerPixel = await sample(marker, 1, px, py, scale);
                        const rows = new Float32Array(2 * FLOATS_PER_INSTANCE);
                        writeInstance(rows, 0, 200, 300, 0.5, spriteIndex(`wallJoin${mask}`), 1, 1, 1, 0, mask, step);
                        let pass = true;
                        for (const [delta, markerWins] of [[-0.1, true], [0.1, false]]) {
                            writeInstance(rows, 1, px, py, expected + delta * step, spriteIndex('floor'), 1, 0, 1);
                            const pixel = await sample(rows, 2, px, py, scale);
                            const same = pixel.every((v, c) => v === markerPixel[c]);
                            pass &&= same === markerWins;
                        }
                        results.push({ mask, x, y, scale, isNear, pass });
                    }
                }
            }
        const error = await gpu.device.popErrorScope();
        return { pass: !error && results.length > 30 && results.every(r => r.pass), error: error?.message ?? null, results };
    }
    finally {
        gpu.device.destroy();
    }
}
export async function doorTraversalProof({ show = false } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 440;
    const gpu = await initDevice(canvas);
    gpu.device.pushErrorScope('validation');
    const renderer = await SpriteRenderer.create(gpu);
    const board = document.createElement('div');
    if (show) {
        board.id = 'door-proof';
        board.style = 'position:fixed;inset:0;z-index:999999;overflow:auto;background:#17171c;display:flex;flex-wrap:wrap;color:white';
        document.body.append(board);
    }
    const results = [];
    try {
        for (const axis of [0, 1])
            for (const alpha of [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const x = axis === 0 ? 11 + alpha : 8, y = axis === 0 ? 8 : 11 + alpha, scale = 3;
                const id = simBodySprite(1, VISUAL_ACTION_WALK, axis === 0 ? 1 : 3, 0, false, x, y);
                const prop = new Float32Array(FLOATS_PER_INSTANCE);
                writeInstance(prop, 0, 200 + spriteDrawOffsetX(id) * scale, 350 + spriteDrawOffsetY(id) * scale, layeredDepth(x, y, 16, LAYER_SIM), id);
                const ox = 200 - (x - y) * 32 * scale, oy = 350 - (x + y) * 21 * scale;
                const capture = async (door) => {
                    const edges = [];
                    for (let row = 6; row < 11; row++)
                        edges.push(axis, axis === 0 ? 12 : row, axis === 0 ? row : 12, row === 8 ? door : 0);
                    const geometry = buildStaticInstances({ width: 16, height: 16, walls: new Uint32Array(), edges: Uint32Array.from(edges) }, ox, oy, 16, scale);
                    renderer.setStaticGeometry(geometry.instances, geometry.count);
                    renderer.draw(prop, 1, scale);
                    await gpu.device.queue.onSubmittedWorkDone();
                    const copy = document.createElement('canvas');
                    copy.width = 400;
                    copy.height = 440;
                    const ctx = copy.getContext('2d');
                    ctx.drawImage(canvas, 0, 0);
                    const data = ctx.getImageData(0, 0, 400, 440).data;
                    let shirt = 0;
                    // Bill's green shirt is distinct from the neutral floor and wall.
                    for (let n = 0; n < data.length; n += 4)
                        if (data[n + 1] > data[n] + 10 && data[n + 1] > data[n + 2] + 4)
                            shirt++;
                    return { copy, shirt };
                };
                const solid = await capture(0), door = await capture(1);
                const pass = door.shirt > 200 && (alpha < 0.5 ? door.shirt > solid.shirt + 100 : true);
                results.push({ axis, alpha, solidShirt: solid.shirt, doorShirt: door.shirt, pass });
                if (show) {
                    const section = document.createElement('section');
                    section.append(`Door ${axis}, progress ${alpha}`, door.copy);
                    board.append(section);
                }
            }
        const error = await gpu.device.popErrorScope();
        return { pass: !error && results.every(r => r.pass), error: error?.message ?? null, results };
    }
    finally {
        gpu.device.destroy();
    }
}
