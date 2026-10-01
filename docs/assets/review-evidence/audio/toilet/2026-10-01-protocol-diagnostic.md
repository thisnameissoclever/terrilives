# Audio memory protocol diagnostic

Observed 2026-10-01 on Windows with Chrome 154.0.8037.58. This diagnostic used source revision `07365982308a60b6a8630b067fd8be40c5bca353` and the frozen production files `index-B0ws5oeU.js` and `terri_wasm_bg-CVnPYumy.wasm`. It investigates the failed whole-audio memory assessment; it does not replace that assessment or approve release.

## Contents

1. [Method](#method)
2. [Results](#results)
3. [Limits and release boundary](#limits-and-release-boundary)

## Method

`node .tmp/toilet-protocol-diagnostic.cjs`: protocol assertions PASS, exit 0. The temporary driver loaded an instrumented copy of the existing harness in memory. No runtime source, tracked harness, production file or memory limit changed. The driver executed four predefined conditions once, in the order below. It refused to overwrite its report or retry a condition.

The treatment omitted only intermediate forced garbage collection, Chrome's explicit reclamation of unused objects. Both conditions retained the same intermediate heap reads, document counts and audio-diagnostic getter calls. Both conditions retained all four forced-collection calls at the initial and final endpoints. The driver asserted two endpoint samples, eight intermediate samples and the expected collection-call counts for every run.

All runs began at tick 62, world hash `18405848757842447177`, and ended at tick 602, world hash `2251520100923854919`. Initial saves and loaded bundle hashes matched. Enabled runs played four measured flushes; disabled runs played none. Endpoints retained zero active voices. Document nodes and listeners remained unchanged within every run. The browser and preview server closed; no listener remained on port 4195.

Raw report: [protocol-diagnostic.json](protocol-diagnostic.json). Driver SHA-256: `3b5279beb7e52e7ae6958282bbe10df0c8b1f70cb179d0886e7154c49061922d`. Original harness SHA-256: `de942a5286c2d3513a3f32dc144f4a1fe7cc4e1df91103fb97fb6eb2d0c753fc`. The raw report also identifies the instrumented copy and all loaded bundles.

## Results

Each growth value is final collected JavaScript heap usage minus initial collected usage. A negative value means Chrome retained less measured memory at the final endpoint.

| Execution order | Intermediate collections | Audio | Raw growth |
| --- | --- | --- | ---: |
| 1 | Kept | Enabled | 166,516 bytes |
| 2 | Omitted | Disabled | 109,788 bytes |
| 3 | Kept | Disabled | -94,308 bytes |
| 4 | Omitted | Enabled | 180,764 bytes |

The enabled-minus-disabled difference was 260,824 bytes with intermediate collections and 70,976 bytes without them. Both exceed the unchanged 65,536-byte allowance. Neither is a repeatable acceptance result.

The difference fell by 189,848 bytes, but enabled growth increased by 14,248 bytes. Disabled growth increased by 204,096 bytes. The smaller difference therefore does not demonstrate that omitting collections reduced audio memory. The observation warrants investigation of the protocol and controls; it does not establish a cause.

## Limits and release boundary

One observation per condition and a fixed execution order cannot separate collection effects from run-to-run variation or browser-process history. Omitting collection also changes elapsed wall time and real-time audio scheduling. The first run had a WebAssembly capacity of 4,849,664 bytes; the other runs had 5,177,344 bytes. Capacity remained stable within each run. Equal saved worlds and bundle hashes do not establish equal browser or native allocation history.

Every broad page-memory request timed out. The measured raw JavaScript heap reads succeeded, but whole-page memory remains unavailable. The harness races those requests against a timeout without cancelling the requests. That is another measurement limitation, not proof that pending requests caused the observed difference. Intermediate samples without collection include unreclaimed garbage; compare only collected endpoint values when discussing retained memory.

A read-only adversarial review confirmed the arithmetic and identified the disabled-control movement, broad-memory timeouts and differing initial WebAssembly capacities. No flush-specific leak or compiler-allocation cause was established. The existing three-pair memory assessment remains failed. The 120 Hz display check remains unavailable on the observed 60 Hz session. Playback and bounded cleanup evidence remain separate from those release requirements.

The next diagnostic question is which retained objects account for the enabled and disabled endpoint differences, including whether uncancelled measurement requests remain alive. Do not rerun the unchanged assessment to seek a favorable sample. Preserve the failed assessment and this diagnostic separately. No public changelog entry is added because this work changes only internal evidence and does not release the flush.
