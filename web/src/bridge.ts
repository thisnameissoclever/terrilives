import type { SimHandle } from './wasm/terri_wasm.js';

/**
 * Zero-copy view over simulation state living in WASM linear memory.
 *
 * CRITICAL: WASM memory can grow, and growth DETACHES every existing
 * typed-array view over the old ArrayBuffer. A detached view reads as
 * empty or throws. Views are therefore constructed fresh on every access
 * rather than cached. Constructing a typed-array view is a pointer-plus-
 * length operation with no copying, so this is cheap; caching them is
 * the classic bug in this pattern, not an optimisation.
 *
 * Three things must be re-read on every access, not two:
 *   1. `memory.buffer`, because growth replaces the ArrayBuffer and
 *      detaches the old one. The `WebAssembly.Memory` object itself is
 *      stable, which is why it is safe to hold; its `.buffer` is not.
 *   2. the pointer, because the underlying `Vec` reallocates on growth
 *      and moves.
 *   3. the length, because spawns change the entity count.
 * Caching any one of the three is the same bug wearing a different hat.
 *
 * The `WebAssembly.Memory` is injected rather than imported. wasm-pack
 * `--target web` emits a `_bg.wasm` that imports a `_bg.js` glue module
 * which only exists for `--target bundler`, so `import { memory } from
 * './wasm/terri_wasm_bg.wasm'` cannot resolve under Vite or Vitest.
 * Callers pass the `memory` field of the object `init()` resolves to.
 *
 * See ARCHITECTURE.md [D11] and risk [R1].
 */
export class SimBridge {
  constructor(
    private readonly handle: SimHandle,
    private readonly memory: WebAssembly.Memory,
  ) {}

  tick(): void {
    this.handle.tick();
  }

  get count(): number {
    return this.handle.entity_count();
  }

  positions(): Float32Array {
    return new Float32Array(
      this.memory.buffer,
      this.handle.positions_ptr(),
      this.count * 2,
    );
  }

  prevPositions(): Float32Array {
    return new Float32Array(
      this.memory.buffer,
      this.handle.prev_positions_ptr(),
      this.count * 2,
    );
  }

  kinds(): Uint32Array {
    return new Uint32Array(
      this.memory.buffer,
      this.handle.kinds_ptr(),
      this.count,
    );
  }

  spawnAgent(x: number, y: number, hunger: number): void {
    this.handle.spawn_agent(x, y, hunger);
  }

  spawnObject(x: number, y: number): void {
    this.handle.spawn_object(x, y);
  }

  /**
   * The u64 world digest. Stays a bigint on purpose: coercing it through
   * `Number()` silently drops the low bits, which is exactly the part a
   * digest comparison depends on.
   */
  worldHash(): bigint {
    return this.handle.world_hash();
  }
}
