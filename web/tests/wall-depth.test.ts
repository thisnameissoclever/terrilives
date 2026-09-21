import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildStaticInstances } from '../src/render/tiles.js';
import { FLOATS_PER_INSTANCE, OFFSET_WALL_MASK, OFFSET_WALL_DEPTH_STEP } from '../src/render/instances.js';
import { layeredDepth, LAYER_PROP } from '../src/render/iso.js';
import { SPRITES } from '../src/render/atlas.js';
describe('edge wall projection', () => {
    it('packs each wall axis and join, with a world-space depth step independent of zoom', () => {
        for (const scale of [1, 1.75, 3]) {
            const result = buildStaticInstances({ width: 16, height: 12, walls: new Uint32Array(),
                edges: Uint32Array.from([0, 12, 6, 0, 0, 12, 7, 1, 1, 12, 6, 0, 1, 13, 6, 1]) }, 0, 0, 16, scale);
            let joins = 0, doors = 0;
            for (let n = 0; n < result.count; n++) {
                const row = result.instances.subarray(n * FLOATS_PER_INSTANCE, (n + 1) * FLOATS_PER_INSTANCE);
                const name = SPRITES[row[3]].name;
                if (n < result.floorCount) {
                    expect(Array.from(row.subarray(8))).toEqual([0, 0]);
                    continue;
                }
                const expectedMask = name === 'wallNS' || name === 'doorwayJoinedNS' ? 5 :
                    name === 'wallEW' || name === 'doorwayJoinedEW' ? 10 : Number(name.replace(/wall(?:Join|Half)/, ''));
                expect(row[OFFSET_WALL_MASK]).toBe(expectedMask);
                expect(row[OFFSET_WALL_DEPTH_STEP]).toBe(Math.fround(layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP)));
                if (name.startsWith('wallJoin'))
                    joins++;
                if (name.startsWith('doorway'))
                    doors++;
            }
            expect(joins).toBeGreaterThan(0);
            expect(doors).toBe(2);
        }
    });
    it('leaves legacy cell walls on their original depth contract', () => {
        const result = buildStaticInstances({ width: 4, height: 4, walls: Uint32Array.from([2, 2]) }, 0, 0, 4);
        for (let n = 0; n < result.count; n++)
            expect(Array.from(result.instances.subarray(n * FLOATS_PER_INSTANCE + 8, (n + 1) * FLOATS_PER_INSTANCE))).toEqual([0, 0]);
    });
    it('keeps shader wall dimensions tied to the authored raster projection', () => {
        const style = readFileSync('../assets/sprites/gen/style.py', 'utf8');
        const objects = readFileSync('../assets/sprites/gen/objects.py', 'utf8');
        const shader = readFileSync('src/render/sprites.wgsl', 'utf8');
        expect(style).toMatch(/TILE_HALF_WIDTH = 32/);
        expect(style).toMatch(/TILE_HALF_HEIGHT = 21/);
        expect(style).toMatch(/Z_UNIT = 38/);
        expect(objects).toMatch(/WALL_H = 2\.0/);
        expect(shader).toContain('abs(raster.x) / 32.0');
        expect(shader).toContain('floor(21.0 / 2.0) + 0.5) - 76.0');
    });
});
