# Prepared character rendering comparison

The first prepared-body checkpoint matches the frozen preceding renderer in all four recorded graphics attachments across 178 saved gameplay scenes. Color uses the full intermediate `rgba16float` representation; physical surface depth, physical identity, and annotation identity are also exact. No color tolerance or image masking was used.

The reference is the real copied source under `.scratch/prepared-character-baseline/web`, served at port 5192. The prepared checkpoint used the development game at port 5187. Both use the same saved bytes, a 1600 by 1100 viewport, scale 1.37, flat lighting, and identical camera placement. Each browser has isolated storage and closes in `finally`.

## Receipts

1. `baseline-settled/receipt.json`: PASS, 178 reference scenes, no page or graphics errors.
2. `prepared-settled/receipt.json`: PASS, all 178 input hashes and attachment hashes match, no page or graphics errors.
3. The full screenshot sequences are available in the [snapshot before cleanup](https://github.com/thisnameissoclever/terrilives/tree/7c7cfa2274729716b35fda168653c2dfe687d079/docs/evidence/2026-10-13-creator-repair/prepared-parity). The source checkpoint includes the prepared-body worker's manifest at `.scratch/prepared-resource-source-hashes.json`, bundle SHA-256 `801aa0f6cff181a2efe5dedc23fae40154dd3567535d692a235c4232f1594b62`, plus the separately recorded head-envelope and device-pipeline changes.
4. `retained-hands/receipt.json`: PASS, all 178 cases remain exact after retaining the mopping hands and their deformation resources.
5. `contact-final/receipt.json`: PASS, all 178 cases remain exact after required background contact preparation and transactional admission. Every captured input and graphics attachment matches the frozen reference. The recorded source hashes are unchanged across this final run, with no page or graphics errors.
6. `sleep-prepared/receipt.json`: PASS, exit 0. All 178 saved scenes retain exact color, physical depth, physical identity, and annotation identity after required sleeping preparation and retained fixture covers. Source hashes remain unchanged, and the browser reports no errors.

The corpus includes the four-facing interaction saves, all final dining settings, final reclining cases, the shared-bed defect, and the dropped book. These are saved phases, not a replacement for testing entry, exit, or every continuous slider value. Later changes need their own comparison against this frozen reference.

## Capture correction

The first `baseline/` and `prepared/` run found 25 color-only mismatches. All depth and identity hashes matched. Of the corresponding displayed screenshots, 21 matched exactly; four differed near a bystander and adjacent wall.

`raw-baseline-2/` reproduces color changes in the unchanged reference alone, with the same tick and every actor field unchanged. The two raw color captures differ at 7,934 samples, with a maximum linear channel difference of 0.19775390625. This is larger than a rounding discrepancy.

`WallFade.update` advances a 200 ms presentation transition using real frame time even while simulation is paused. Its translucent pass changes color without writing physical depth or identity. Capturing after only two animation callbacks sampled different stages of that legitimate transition. The faster prepared renderer made the timing difference easier to observe.

The corrected recorder waits 250 ms after loading, then waits two rendered frames. Its first scene must produce identical full attachments on repeated captures. `settled-baseline-check/` passes that assertion for the formerly unstable bath scene, and both complete settled runs pass. The original failures and raw buffers remain preserved.

## Commands

From the repository root:

```powershell
$env:PARITY_LABEL='baseline-settled'
node scripts/character-creator-repair/check-prepared-parity.cjs

$env:PARITY_LABEL='prepared-settled'
$env:PARITY_URL='http://127.0.0.1:5187'
$env:PARITY_REFERENCE='docs/evidence/2026-10-13-creator-repair/prepared-parity/baseline-settled/receipt.json'
node scripts/character-creator-repair/check-prepared-parity.cjs
```

Both commands exited 0. Choose a new label when rerunning; the recorder refuses to overwrite an existing receipt.

## Deterministic bike fitting

The required background contact compiler deliberately fixes its reference at authored phase zero. The previous lazy fitter used whichever animation phase first entered the cache. The extra exercise fixture enters at phase 2, so its old and new raw graphics attachments are not bit-identical. This difference is retained as a failure in `contact-prepared/receipt.json` and `contact-canonical-raw/receipt.json`; neither receipt is relabeled as exact parity.

The four mopping scenes in `contact-prepared/` match every attachment exactly. The four exercise scenes have identical physical identities, annotation identities, and decoded displayed screenshots. Full-buffer comparison finds 46 changed surface samples and three changed color samples, all owned by the exercising person. The maximum surface difference is `7.152557373046875e-7`; the maximum linear color difference is `0.0001220703125`. These are measured differences, not acceptance tolerances. `contact-phase-delta.json` records each case, and `analyze-contact-delta.py` compares all buffer bits before selecting changed samples for analysis.

The causal diagnostic at `contact-phase2-causal/receipt.json` changes only the consumed fit in an isolated browser. The independently regenerated old phase-2 fit preserves signed zero. Injecting it into the unchanged current renderer reproduces all four old attachment sets exactly. Restoring the original method and reloading the final saved scene reproduces the canonical attachment set exactly. Source hashes remain unchanged, and the browser closes afterward. This diagnostic attributes the raw difference to the intentional reference-phase correction; it is not a substitute production baseline.

The corresponding CPU evidence lives in [bike contact compilation](../bike-contact-compilation/). It keeps the original phase dependence, the deterministic construction contract, and the source/surface comparisons separate.
