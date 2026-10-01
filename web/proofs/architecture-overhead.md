# Architecture timing investigation

Run this proof in an isolated visible browser page. It requires the optional WebGPU `timestamp-query` feature and explicitly fails acquisition if the adapter cannot provide it. It does not change production device creation or renderer code.

Prepare the pinned baseline first:

```powershell
python -B web/proofs/prepare-architecture-baseline.py
```

Use separate browser calls for creation, configuration and each round. Extract and save every returned result immediately; do not keep the only copy in page globals until the final call.

```javascript
const { createArchitectureBenchmark } = await import('/proofs/architecture-overhead.js');
globalThis.bench = await createArchitectureBenchmark();
// Return and persist bench.metadata now.
```

```javascript
await bench.configure({ scale: 1, cutaway: true });
// Return and persist the configuration, hashes and pixel controls now.
```

```javascript
await bench.runRound({ round: 0, warmup: 60, frames: 120 });
// Return and persist this complete round now, then repeat with round 1, 2, ...
```

One round contains three arm blocks and takes about nine seconds at 60 Hz with those settings. Each arm warms independently before sampling. Three rounds rotate each arm through every position; six rounds also balance every ordered adjacency. `configure({scale: 1.75})` selects the same logical lot at fractional enlargement if that additional case is justified. Keep the same warmup/sample settings across comparable rounds.

All arms use the final 34x34 logical lot and the same canvas, camera and twelve dynamic rows:

1. `baselineHistorical`: pinned historical renderer and historical geometry.
2. `candidateHistorical`: current renderer and the exact same historical geometry bytes.
3. `candidateFinal`: current renderer and authored architecture geometry.

Configuration requires exact pixel equality between the two historical-geometry arms, plus opaque clear and visible non-background controls for every arm. Each round checks that input hashes remain unchanged. Switching arms uploads their static geometry before warmup. The current renderer and architecture resources are shared between its two arms.

Each result separates synchronous `renderer.draw` CPU time, actual GPU render-pass time and requestAnimationFrame cadence. The CPU interval includes the same counter/timestamp hook in each arm. GPU timestamps bracket the renderer's actual pass, excluding uploads, queue waiting, readback and JavaScript promise resumption. There is no per-frame completion fence, query resolve or map. The proof preallocates 240 query slots and two 1920-byte buffers, then resolves, copies and maps once after each 120-frame arm block. Those readback operations are separate from frame counters.

The result retains raw uint64 timestamp strings and subtracts them before conversion to JavaScript numbers. Zero durations remain in the distribution. An all-zero block cannot establish GPU cost. The observed greatest common divisor of nonzero durations is descriptive; it does not establish the device's timer precision. CPU/GPU distributions and refresh-limited cadence have different meanings, and a steady 60 Hz is not performance acceptance.

After extracting all desired rounds:

```javascript
await bench.finish();
// Persist GPU validation and the complete observed resource descriptors.
bench.dispose();
```

Always call `dispose()` in the caller's `finally` path and close its owned page/context. `finish().pass` refers only to GPU validation. It is not a cost threshold or owner approval. Do not edit any imported proof, metadata helper or source while this page exists: Vite hot reload can destroy unextracted evidence.

Focused non-browser checks:

```powershell
node --check web/proofs/architecture-overhead.js
node --test web/proofs/architecture-benchmark-metrics.test.mjs
```
