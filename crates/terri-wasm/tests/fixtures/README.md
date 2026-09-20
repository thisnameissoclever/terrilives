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
