# Save fixtures

`pre-bathtub-rotation.hex` contains hexadecimal bytes from a test household
saved through the browser's Save button on 2026-09-20. The local PR83 build
used `index-D_1Z72To.js` and `terri_wasm_bg-DBfCk5aJ.wasm`, before changing
the bathtub's 2x1 footprint. It is our disposable local test slot, not the
owner's production save.

The save is Day 1, 02:14, with 37 entities and zero funds. Its decoded binary
length is 2,580 bytes and SHA-256 is
`1b4393f7741a66896b7d655d5378dd27a888e32b6d0cbb409cd4e96cd0def2ec`.
Its original content fingerprint is `a020602a6acd3a90`.

The public-loader test preserves every saved field except the two bathtub
collision bits and destination fingerprint, then compares 300 ticks after a
second save/load. Synthetic fixtures separately exercise affected agents,
conversations, active baths, legacy names and invalid inputs.

`pre-builder-600.hex` and `pre-builder-908.hex` contain actual Save V1 bytes
written by the preceding front-door release WASM, before the facing suffix
was introduced. A fresh `SimHandle.from_lot()` was advanced by 600 or 908
ticks, then saved with `save_bytes()`. The first is at work; the second is
crossing the front door on return. Both carry the published combined-content
fingerprint `fdf587d9437fbfd0` and contain no `object_facings` field.

The source WASM was read from the front-door-round-4 worktree on 2026-09-20.
Its SHA-256 was
`4a0419edfed74f52d037972c48a0e8d13132b9e9a660bfdd1d4519f941878104`.
Tests preserve entities, occupancy and funds across the load, then compare
320 ticks of replay after another save/load.

The web portal test constructs a B-fingerprint case by replacing only the
fingerprint in the historical 600-tick D bytes. That case proves the exact
pre-door bridge with the historical wire shape; it is not a captured B save.
