# Shared-scene GPU contract checks

`node scripts/character-creator-repair/check-scene-contracts.cjs` completed with exit code 0. The final receipt records eleven passing baseline/restoration checks, eight killed mutations, no uncaptured GPU errors, and unchanged production-file SHA-256 hashes.

The final run follows extraction of the shared pipeline definitions and promotion of the exact-color dropped-book bundle. The earlier receipt and log remain in `receipt-pre-extraction.json` and `pre-extraction.log`. `pipeline-dependencies.json` checks the newly extracted definition files against the earlier frozen shader-gate hashes; subsequent harness runs also include those files directly in their before/after hash set. This metadata addition did not change a pixel assertion or production code.

The harness creates an isolated Chrome context, a blank same-origin document at the task's Vite server on port 5187, and its own GPU device. It runs the production `SpriteRenderer.create`, production constructor and draw path, production WGSL, and production `SceneTarget.resolve` and `pick`. It replaces two ordinary activity-sprite crops only in its own atlas texture. Shader mutations apply while constructing disposable lab renderers, then restore `createShaderModule` immediately. Other mutations remove vertex-buffer restoration or the nearest-depth selection guard inside this isolated page. All renderers, the canvas, device, browser context and browser are destroyed or closed in `finally` blocks.

1. Ordinary black/white source texels interpolate in linear light. Transparent cyan source RGB cannot contaminate visible red samples. Expected values come from independent CPU arithmetic.
2. Alpha 64/255 covers one of four scene subpixels. A nearer red owner occupies that sample; blue geometry behind it occupies the other three. Color resolves to the sRGB encoding of a 25% red, 75% blue linear mixture. Surface depth and identity remain categorical. Picking selects the nearer owner despite its smaller coverage.
3. A real registered toilet checks 4,579 opaque source witnesses at fractional scale and position against independently decoded atlas bytes and companion RG16 depth bytes.
4. A real southeast shelf with stock bit zero present checks 107 witnesses where that book is nearer than the shell. Its independently reconstructed signed stock color and physical stock depth use the same source texel. Maximum linear color error was 0.000241923; maximum depth error was 0.0000000309. Limits remained 0.001 and 0.000001 respectively.
5. A low wall remains visible after a dynamic-draw callback replaces both sprite vertex-buffer bindings. It preserves the opaque geometry's categorical identity.

All six shader mutants compiled without errors before their assertions failed. The two runtime mutations used the already compiled production pipelines. The final restoration pass reran linear filtering, coverage and picking, shelf stock, and low-wall checks.

| Mutation | Observed failure |
| --- | --- |
| Encoded straight-color filtering | Linear value 0.0736084 instead of 0.3 |
| Transparent RGB included in filtering | Gray 0.213989 instead of red 1,0,0 |
| Half-alpha discard | Four background owners instead of one foreground and three background |
| Filtered registered fixture color | Color differs from the point-selected source texel |
| Independently filtered shelf color | Stock color differs from the depth-selected source texel |
| Ignore present-stock depth | Depth 0.529852 instead of 0.501511 |
| Remove vertex-buffer restoration | Blue background remains where the red low wall belongs |
| Pick last covered owner | Owner 19 instead of nearer owner 41 |

`receipt.json` contains the exact witnesses, mutation replacements, failure messages, compilation result, device information and production hashes. `final-run.log` preserves the complete command output. `first-run.log` preserves the initial successful seven-mutation run before the explicit compilation receipt and nearest-owner mutation were added.

These are focused GPU regression checks. The real-artwork cases cover one toilet view and one southeast shelf stock state; they do not establish acceptance for every fixture, pose, facing or body configuration. Actual gameplay, visual review and performance measurement are separate gates.
