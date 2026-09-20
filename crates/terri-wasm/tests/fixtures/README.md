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

`pre-front-door-schema2.hex` is the output of
`SimHandle.from_lot().save_bytes()` from the checked-in browser module at
main commit `c0eca3018f4b0e8ef41e2f023389d736fe99cd0c`. The JavaScript SHA-256 is
`d2e855c70ad938dab7bd44646b4883366f1c6db762eaec900304f5e3946482c5` and
the WASM SHA-256 is
`eaf35f7b68825a303ccd6c96fc5d3e4b5d40c057cc46846376f29535541ac99f`.
The fixture is 2,679 bytes with save SHA-256
`aa79fbdde5fc12e711ca18851cb28797d099b8678625195bce42df788dc8f6a2`.
It carries Schema 2, the rotated-bathtub pre-door fingerprint
`bcdd476e1e238ab0`, and the previous release's 34 saved wall edges. It came
from a fresh local simulation, not the owner's save data.

The public-loader test preserves every saved field except the two bathtub
collision bits, the 28 reclaimed wall cells and destination fingerprint,
then compares 300 ticks after a second save/load. V2 adds explicit boundary
architecture around that preserved world; V3 retains it and adds object directions.
Synthetic fixtures separately exercise affected agents,
conversations, active baths, legacy names and invalid inputs.

`pre-builder-600.hex` and `pre-builder-908.hex` contain actual Save V1 bytes
written by the preceding front-door release WASM. V1 and V2 remain frozen;
only V3 stores object directions. A fresh `SimHandle.from_lot()` was advanced by 600 or 908
ticks, then saved with `save_bytes()`. The first is at work; the second is
crossing the front door on return. Both carry the published combined-content
fingerprint `fdf587d9437fbfd0` and contain no `object_facings` field.

The source WASM was read from the front-door-round-4 worktree on 2026-09-20.
Its SHA-256 was
`4a0419edfed74f52d037972c48a0e8d13132b9e9a660bfdd1d4519f941878104`.
Tests preserve entities, furniture occupancy and funds across the load,
reclaim exactly the historical 28 wall cells into saved boundary edges, then
compare 320 ticks of replay after another save/load.

The web portal test loads the real B-fingerprint Schema 2 fixture above.
The core wire tests decode and re-encode actual V1 and V2 fixture payloads
byte-for-byte; the WASM tests separately verify their migration and replay.
No fixture fingerprint is substituted to impersonate an older wire format.
