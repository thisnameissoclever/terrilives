# Production shader and pipeline preflight

The production renderers and the GPU preflight now use the same assembled WGSL, explicit binding layouts, vertex attributes, entry points, overrides, color targets, blend settings and depth settings. The shared definitions are in `sprite-pipelines.ts`, `scene-pipeline.ts` and `character/pipelines.ts`. Existing constructors use those definitions without loading a second rendering implementation.

The final Chrome run passed 48 pipeline creations on an NVIDIA Lovelace adapter. Three deliberate device-boundary cases rejected 17 sampled textures against the production device's limit of 16. All five isolated fault injections failed, including two whose shader text compiled successfully. These receipts establish shader and pipeline validity; they do not establish correct pixels, physical contacts, visual acceptance or frame timing.

## Coverage

1. Sprites: opaque, short-wall and grime descriptors at every count accepted by the architecture shader assembler, zero through twelve. Zero through eleven pass. Twelve exceeds this device's limit and must fail specifically at that limit with clean shader compilation.
2. Characters: fill and outline, each using the scene and inspection color formats.
3. Scene resolve: the actual 2x resolve shader with both `bgra8unorm` and `rgba8unorm` output formats.
4. Character paths: compositor, preview fixture, world-picking compute, skinning compute, subdivision compute and surface-normal compute.
5. The shipped finish catalogue has seven distinct texture resources. The preflight prepares the complete catalogue and checks every bounded custom-resource count against the actual sprite layout. It does not infer coverage from the current catalogue alone.

## Texture-budget correction

The architecture loader and direct-device guard previously reserved four fixed textures. The actual shader layout always binds five: atlas, architecture depth, architecture color, architecture roles and joint alpha. The old guards admitted twelve patterns on a sixteen-texture device, then GPU pipeline creation failed.

Both guards now reserve five and enforce the assembler's twelve-pattern ceiling. Eleven patterns pass on a sixteen-texture device; twelve require a device exposing at least seventeen texture bindings. Production device requests remain unchanged. All seven shipped resources remain available. Two new unit tests failed against the old guards before the correction and pass afterward.

## Reproduction and receipts

Run these commands from the repository root unless the working directory is specified:

1. `node scripts/character-creator-repair/check-shader-pipelines.cjs` - PASS, exit 0. See `gpu-preflight.log`, `receipt.json`, `baseline.json`, and `restored.json`.
2. From `web`: `npm run typecheck` - PASS, exit 0. See `typecheck.log`.
3. From `web`: `npx vitest run tests/architecture.test.ts tests/architecture-resources.test.ts tests/iso.test.ts tests/instances.test.ts --maxWorkers=1` - PASS, exit 0; 76 tests across four files. See `unit-tests.log`.
4. From `web`: `npx vitest run tests/character-device-lifetime.test.ts tests/preview-fixture.test.ts tests/character-world-contract.test.ts tests/character-resources.test.ts --maxWorkers=1` - PASS, exit 0; eight tests across four files. See `character-tests.log`.

`commands.json` records the commands and their relevant output, including the two intentionally failing budget regressions. `before-extraction.json` preserves the starting file hashes. `before-budget-fix-receipt.json` records the initial GPU evidence before correcting the guards. `unit-tests-before-contract-update.log` retains the stale source-assertion failures; the assertions now follow the current scene target, sampler and coverage owners.

The script copies `web/src` into a new directory under `.scratch/creator-repair-validation/`; it never mutates live production files. Every source under that copied directory is an ordinary copied file. It creates its own Vite server on an available loopback port, Chrome browser contexts and GPU devices. Browser contexts, the browser and the server close in `finally` blocks. The request inventory verifies that no atlas images or character geometry were fetched.

Each pipeline check awaits `getCompilationInfo()` and `createRenderPipelineAsync()` or `createComputePipelineAsync()`. It records compilation messages, pipeline promise rejections and validation scopes separately. The check rejects an empty or incomplete sweep. Each record includes the assembled shader hash and exact descriptor fields; explicit binding entries are recorded alongside their descriptors. Production hashes before and after all mutations must match, and the restored shader/layout/descriptor signatures must equal the baseline.

## Adversarial controls

1. Duplicate interstage location 14: rejected by shader compilation; 39 sprite variants fail, including the boundary cases that now fail for the wrong reason.
2. A `vec3` passed to the character recoloring function's `vec4` parameter: rejected by shader compilation; all four character variants fail.
3. A comma-separated WGSL `let` declaration: rejected by shader compilation; the world-picking compute pipeline fails.
4. Integer color target for a floating-point shader output: shader compilation succeeds, then the awaited pipeline promise rejects; twelve supported opaque sprite variants fail.
5. Uniform buffer declared where the character shader requires storage: shader compilation succeeds, then the awaited pipeline promise rejects; all four character variants fail.

Each mutation has a named JSON file with the actual compiler or pipeline diagnostic. `receipt.json` records mutation anchors, changed hashes and restored hashes. The numeric scene/pixel contract and real gameplay review remain separate required evidence.
