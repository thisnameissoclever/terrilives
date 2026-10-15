import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { neutralAppearance } from '../src/render/character/appearance.js';
import { decodeGeometry, geometryBuffers, type Bundle } from '../src/render/character/bundle.js';
import { posedPositions } from '../src/render/character/geometry-proof.js';
import { anatomicalHeight } from '../src/render/character/shape.js';

describe('physical contact witness export', () => {
  it('emits finite complete indexed surfaces for all 18 seated configurations', () => {
    const base = new URL('../../assets/models/sims/appearance-proof/export-v2/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8')) as Bundle;
    const bytes = (name: string) => Uint8Array.from(readFileSync(new URL(name, base))).buffer;
    const geometry = decodeGeometry(manifest, 'runtime', Object.fromEntries(geometryBuffers.map(name => [name, bytes(manifest.runtime[name])])) as Record<typeof geometryBuffers[number], ArrayBuffer>);
    for (const name of geometryBuffers) {
      expect(createHash('sha256').update(new Uint8Array(bytes(manifest.runtime[name]))).digest('hex'))
        .toBe(manifest.runtime[`${name}Sha256`]);
    }
    const directory = new URL('../../.superpowers/sdd/2026-10-12-character-appearance-proof/contact/', import.meta.url);
    mkdirSync(directory, { recursive: true });
    const cases: unknown[] = [];
    for (const presentation of ['masculine', 'feminine'] as const) for (const height of [0, 50, 100]) for (const build of [0, 50, 100]) {
      const a = { ...neutralAppearance(), presentation, height, build, hairstyle: presentation === 'feminine' ? 'bob' as const : 'curl' as const };
      const top = anatomicalHeight(geometry.vertices);
      for (let frame = 0; frame < manifest.actions.read.length; frame++) {
        const positions = posedPositions(geometry, a, 'read', frame, top);
        expect(positions.length).toBe(geometry.description.vertexCount*3);
        expect([...positions].every(Number.isFinite)).toBe(true);
        const file = `${presentation}-${height}-${build}-${frame}.bin`;
        writeFileSync(new URL(file, directory), new Uint8Array(positions.buffer));
        cases.push({ file, appearance: a, frame });
      }
    }
    writeFileSync(new URL('cases.json', directory), JSON.stringify(cases, null, 2));
    const root = new URL('../../', import.meta.url);
    const inputs = ['web/src/render/character/shape.ts', 'web/src/render/character/pose.ts',
      'web/src/render/character/geometry-proof.ts', 'web/src/render/character/surface.ts',
      'web/src/render/character/math.ts', 'web/src/render/character/motion.ts',
      'assets/models/living/armchair_support.py', 'web/src/render/character/bundle.ts',
      'assets/models/sims/appearance-proof/check_contacts.py',
      'assets/models/sims/appearance-proof/export-v2/manifest.json',
      ...geometryBuffers.map(name => `assets/models/sims/appearance-proof/export-v2/${manifest.runtime[name]}`)];
    writeFileSync(new URL('inputs.json', directory), JSON.stringify(Object.fromEntries(inputs.map(p => [p,
      createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex')]))));
    expect(cases.length).toBe(72);
  }, 60000);
});
