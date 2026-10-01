# Starting double-bed access

The new-game double bed moves from `(0, 6)` to `(0, 8)`, retaining its SE facing
and 2x2 footprint. No other furniture, wall or household spawn moves. Existing
saves retain their own placement and collision grid. Occupied visuals remain
unverified; this change does not make the complete bed feature ready to ship.

## Observed failure and correction

The actual release WASM admitted the first assigned Sim to ordinal one and
left the second waiting. Place zero's authored approach was across the solid
bedroom wall. The native shipped-household regression reproduced the failure
before the correction (`cargo test -p terri-sim beds::tests::shipped -- --nocapture`,
exit 101):

```text
shipped_double_bed_admits_two_walkers_and_sleepers_without_changing_the_household
assertion `left == right` failed
  left: Some(SleepPlace(1))
 right: Some(SleepPlace(0))
```

The content compiler rejected two candidate positions: `(0, 7)` isolated a
floor pocket beside the nightstand, and `(1, 7)` covered Bill's `(2, 8)` spawn.
A complete TOML graph check and independent read-only review found `(0, 8)`
was the sole valid origin within two tiles of the old origin. All 278 free
floor tiles remain connected and all three spawns remain free. Place zero
uses `(0, 7)` or `(1, 7)`; place one uses `(1, 10)`. The dresser blocks only
the other place-one approach, `(0, 10)`.

The native regression uses the shipped content, all three household members
and seed 2301. It issues assignment and object-use commands, then requires
both ordered Sims to walk and sleep with their exact places and targets.
It compares complete persisted state and world hashes after loading during
walking and sleeping. Positions, paths and action durations are not patched.

## Release WASM and saved households

`wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
passed with exit 0. The optimized binary SHA-256 is
`564035eedbc13836565dd93afda3bcb62aafc3d753f5c3f82d4d070411cd5eb1`.

The release-WASM fixture exporter passed with exit 0 and produced three
independent bed-era save records for the privacy extension's compatibility
checks. Actors 34 and 35 occupy bed 19, ordinals zero and one, at `(0, 8)`.
Walking is observed at tick one and both sleeping at tick 53. Every record
loads and re-saves byte-identically with the same world hash.

| Save state | Bytes | SHA-256 |
| --- | ---: | --- |
| Two assigned walkers | 3234 | `fadfcb1a1404eaa557a72f2ba018b4f99801adde34220cb6841161125f1a3b2c` |
| Two assigned sleepers | 3216 | `e5e806e578f0c770800466a77afe6093e54964442770bfda2bffe65060271ea8` |
| Two sleepers with pending assignment clear | 3219 | `974e6b669f710c974b4aa949e2ef0ea4b146851f4945e6312fa24c5c2e1a56c3` |

The pending-clear record replays for 40 ticks with exact save/hash equality.
Only actor 34's permanent assignment clears; both active sleeping leases and
actor 35's assignment remain. Scratch records and their generator are under
`.tmp/bed-assignment/bed-era-release-fixtures/` and
`.tmp/bed-assignment/export-bed-era-fixtures.mjs` respectively.

Before rebuilding, the previous release WASM saved the unchanged household
with the bed at `(0, 6)`. The corrected build loads those 3148 bytes, re-saves
them identically, and retains world hash `5621729768197408286`. The native
old-position save test also retains the complete saved state, assignment and
hash. The content digest remains `b38e71a123bb8273`.

All four historical constructor paths use
`crates/test-fixtures/pre-yard-placements.rs`, which freezes 34 ordered object
identities, origins and absolute facings from `e356b949`. Each adapter checks
the object count and identities. Walls, lot dimensions and the pre-rotation
bathtub remain explicit era-specific inputs. The yard migration's expected
grown world uses the same historical placement. The production bathtub source
validator and captured `.hex` fixtures remain unchanged.

## Review and final checks

Independent review confirmed the layout constraints, then identified historical
builders that still inherited current positions. A fresh adversarial review
recommended the shared frozen manifest and stronger assignment/countdown
assertions. Its final review found no blocking defects in the revised diff.

Two deliberate faults proved the strengthened shipped-household assertions.
Both failed the named test with exit 101:

```text
Assignment insertion omitted:
assertion `left == right` failed
  left: 0
 right: 2

Sleep countdown frozen:
assertion `left == right` failed
  left: Some(Eating { object: ObjectDefId(20), interaction: 0, remaining_ticks: 173 })
 right: Some(Eating { object: ObjectDefId(20), interaction: 0, remaining_ticks: 172 })
```

Both files were restored byte-for-byte in `finally`: `beds.rs` SHA-256
`4B79009825E081C1ACD3820017487669A1C7049128D67C67A7F4615DD0073C59` and
`systems/interact.rs` SHA-256
`FAA3D96032CEAD9800556807916E6E80AD8D9DAB2A77588C6D8984E4C7E242BC`.
The restored two-test shipped-household suite passed with exit 0.

| Check | Result |
| --- | --- |
| `cargo test --workspace` | Core 109 and data 270 plus one integration test passed; simulation fixture failures stopped this run. |
| `cargo test -p terri-sim -p terri-wasm` after review repairs | PASS, exit 0: 754 simulation and 152 WASM tests. Combined native total across these runs: 1,286. |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, exit 0. |
| `cargo test -p terri-sim beds::tests::shipped` after fault restoration | PASS, exit 0: two tests. |
| `npm test -- --maxWorkers=1` in `web/` | PASS, exit 0: 1,627 tests. |
| `npm run typecheck` in `web/` | PASS, exit 0. |
| `npm run build` in `web/` | PASS, exit 0, using the rebuilt release WASM. |

Production output contains `terri_wasm_bg-bid0wJUR.wasm` (2,273.96 kB),
`index-C7TqlCL6.css` and `index-B6hVMdnt.js`. The test-only fixture repairs
after that WASM build do not alter production code. Logs are under
`.tmp/bed-assignment/shipped-layout-*.log`. No merge or deployment is claimed.
