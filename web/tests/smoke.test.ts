import { describe, it, expect } from 'vitest';
import init, { smoke_value } from '../src/wasm/terri_wasm.js';
import { readFileSync } from 'node:fs';

describe('wasm toolchain', () => {
  it('returns 42 across the boundary', async () => {
    const bytes = readFileSync('src/wasm/terri_wasm_bg.wasm');
    await init({ module_or_path: bytes });
    expect(smoke_value()).toBe(42);
  });
});
