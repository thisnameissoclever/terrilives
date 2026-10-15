# Creator command memory and saved-byte compatibility

On this Windows native build, `SimCommand` occupied 712 bytes because `CharacterCommand` was stored inline. Boxing only that variant reduces every live command slot to 88 bytes. The creator payload still contains the same data. No warning suppression, dependency change, saved-schema change, JavaScript API change, or random draw was added.

`SaveSnapshotV9.command_order` remains `Vec<Option<CharacterCommand>>`. Capture clones the boxed value into that unchanged saved representation; restore boxes it again for the live queue. The command discriminant remains 30. Execution, validation and hashing continue borrowing the same payload.

## Checks

Commands ran from `D:/VIBES/.worktrees/5637/terrilives`.

| Check | Exact command | Result | Log |
| --- | --- | --- | --- |
| Memory regression before boxing | `cargo test --locked -j 1 -p terri-core command::character_tests -- --test-threads=1 --nocapture` | Expected FAIL, exit 101: slot size 712; wire equivalence passed | `red.log` |
| Command and wire contracts | `cargo test --locked -j 1 -p terri-core command:: -- --test-threads=1 --nocapture` | PASS, exit 0: 15 tests; slot size 88 | `green-core.log` |
| Creator, saved queue, boundary and golden hash | `cargo test --locked -j 1 --lib -p terri-sim -p terri-wasm -- character save::v9:: determinism_tests::world_hash_matches_its_golden_vector --test-threads=1` | PASS, exit 0: 11 simulation tests and 4 WASM boundary tests | `creator-save-boundary.log` |
| Workspace library Clippy | `cargo clippy --locked -j 1 --workspace --lib -- -D warnings` | PASS, exit 0 | `clippy-lib.log` |
| Affected test-target Clippy | `cargo clippy --locked -j 1 -p terri-core -p terri-sim -p terri-wasm --tests -- -D warnings` | PASS, exit 0 | `clippy-tests.log` |

The 30 runtime tests cover both creator command kinds, historical command vectors, an interleaved Create/Edit/ordinary queue, exact typed save round-trips, input refusal, unchanged random state, and the existing native golden world hash. The byte-equivalence test compares code 30 plus the unboxed payload against the live command bytes, then decodes them in both forms and checks truncated input refusal.

Clippy also exposed two redundant `u32` casts in the creator catalogue, one `Needs` clone on a `Copy` type, and three test fixtures assigning fields after `Default::default()`. Those were changed to equivalent expressions and initializers with root approval. The functional tests passed before these behavior-preserving lint cleanups; final scoped Clippy includes them. No assertions were weakened.

## Frozen pre-boxing saves

`capture-pre-box.mjs` instantiated the existing WASM module in a fresh Node process. It did not use a browser, rebuild WASM, or write under `web/src/wasm`. Its binary hash was `cacce77105d1e75c7225e75b89c994e3a6824a275d1e15daf71678ef65d76e15`. The capture script refuses a different binary, preventing accidental regeneration with newer code.

The captured command stream is Select none, edit Sim 0's name to Ann, then Select none. Both saves are frozen native test fixtures under `crates/terri-wasm/tests/fixtures/command-memory/`:

1. `queued-edit-pre-box-v9.sav`: 5,270 bytes, SHA-256 `e94ea6d0d9fe955a8f29f76a34edd7c06175bf08dec143c675d740aa36062fe9`.
2. `completed-edit-pre-box-v9.sav`: 5,244 bytes, SHA-256 `4f8f0f5c48cf4e20f5e880980d68a2dd76e6e77ccdad4a622514b08d47907878`.

The new native boundary test loads the old queued save and reproduces it byte for byte, verifies all three queued commands, flushes them, and reproduces the old completed save byte for byte. It also checks the resulting name and unchanged simulation random state. `pre-box-fixtures.json` records the capture receipt.

## Retained setup failures

The first save-test draft tried to call `postcard` from `terri-sim`, which intentionally has no such dependency. Byte assertions were moved to `terri-wasm`, where the serializer already exists. An expanded creation fixture then reused an existing person's intermediate skill practice. The pre-boxing WASM also refused that Create command with `InvalidSkills`, recorded in `fixture-refusal-detail.json`; the corrected fixture uses a validated neutral new-character draft and explicit affinities.

An earlier Cargo command omitted `--lib` and spent time linking unrelated examples. Only its verified task-owned process tree was stopped with root approval, and its log is retained as interrupted. Another chat's Cargo process and its children were left alone. The replacement command preserved the intended test filters while selecting only library tests.

The dining repair source hashes remained unchanged throughout this task. Root owns the final WASM rebuild and web verification. No public changelog entry is needed for the command allocation or equivalent lint cleanups because they do not change player-facing behavior.
