# Varied autonomy: local validation

Measured 2026-09-30 in the active worktree. These results cover the implemented
source and rebuilt release WASM. The original local pass below preceded delivery;
the integrated review and delivery checks are recorded at the end.

## Checks

| Command | Result | Exit |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | PASS: 106 core, 267 data, 1 CLI, 672 simulation and 137 WASM boundary tests; 1,183 total | 0 |
| `cargo test -p terri-sim systems::autonomy -- --test-threads=1` | PASS: 12 tests after strengthening the repeated comfort-diversity sample | 0 |
| `cargo fmt --all -- --check` | PASS | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS: optimized wasm32 release module | 0 |
| `npm test -- --maxWorkers=1` in `web/` | PASS: 83 files, 1,232 tests | 0 |
| `npm run typecheck` in `web/` | PASS | 0 |
| `npm run build` in `web/` | PASS: production bundle | 0 |
| `python check-doc-ids.py` | PASS: unique, allocation-free IDs | 0 |
| `python assets/sprites/gen/build.py --check` | PASS: unchanged atlas, 1,225 sprites | 0 |
| Eight targeted mechanism mutations | PASS: intended assertions detect each compiled mutation, restored source passes | 0 after restoration |
| `git diff --check` | PASS | 0 |

Cargo builds used two jobs and tests one thread. Targeted mutation commands,
assertion failures, and byte restoration evidence are in
[autonomy-mutation-evidence.md](autonomy-mutation-evidence.md). This is local
targeted evidence; the full remote mutation sweep was not run.

An initial Clippy run found a blank line between fixture doc comments. Removing
that line made the check pass. Earlier regression failures came from assumptions
that available actions always beat waiting, old save-tail offsets, and the old
world hash. Fixtures now check weighted eligibility or explicitly command the
state they intend to serialize. Both native and rebuilt WASM independently
measured the new matching golden hash `0xa1a1f123206ce493`; instinct state and
changed selection draws explain the change.

## Reproducibility and controlled samples

`web/tests/varied-autonomy.test.ts` compares actual positions, visual actions and
interaction targets for 700 ticks: identical seeds reproduce traces; different
seeds differ. A save at tick 317 resumes with identical subsequent choices and
world hash. Existing Rust replay and save suites also pass.

Controlled Rust fixtures run 10,000 seeded samples per comparison. They verify
increasing recovery probability with instinct, meaningful dangerous choices at
0 through 5, ordinary-instinct dangerous probability below 0.001 near imminent
death, full-meter Fun/Social preference with other choices still sampled, and
both interactions independently winning on one object. Integer-bucket tests
prove microscopic alternatives have a selectable generator outcome. Their
probabilities and bucket totals, rather than accidental sample absence, establish
that rare choices remain possible.

Creation samples 3,000 starter values across 1,000 seeds, covering every integer
0 through 100. Migration, validation, accepted and refused arrivals, explicit
zero, unchanged old command encodings, world hashing and transactional loading
have dedicated tests. Legacy fixtures distinguish migration's intentional RNG
draws from continuation of a current save.

## Shipped-content balance

Built with `cargo build -p terri-sim --example trace`, then ran
`target/debug/examples/trace.exe 12000 SEED INSTINCT` for each row. Each command
exited 0. Omitting INSTINCT samples each starter's own value.

| Seed | Instinct | Decisions | Choices with survival risk | Deaths | World hash |
| --- | --- | ---: | ---: | ---: | --- |
| 17 | 30 | 398 | 46 | 0 | `0xaa4a0a3c0d222aeb` |
| 17 | 50 | 429 | 23 | 0 | `0xf7dade27dcc41122` |
| 17 | 70 | 463 | 14 | 0 | `0xd2bc559a70296dd8` |
| 42 | 30 | 432 | 39 | 0 | `0xe7508e07a5fcb0ef` |
| 42 | 50 | 482 | 79 | 0 | `0xa1e6211396e85a98` |
| 42 | 70 | 494 | 51 | 0 | `0xeeb0a8626ca8a57d` |
| 88 | 30 | 477 | 87 | 0 | `0x4a53142e7fa6d3bd` |
| 88 | 50 | 493 | 56 | 0 | `0x1dd6b372e541c747` |
| 88 | 70 | 614 | 119 | 0 | `0x71619a8e323e3b54` |
| 17 | 0 | 352 | 205 | 1 | `0x2482e6649b8be710` |
| 17 | 5 | 399 | 227 | 1 | `0xa6587d2cd877ec8e` |
| 2026 | Random | 406 | 23 | 0 | `0x76dbb5e01d105e2d` |

Across the nine ordinary-instinct runs, no deaths occurred over 108,000 world
ticks. This finite sample supports the defaults; it does not promise immunity
from death. A risky choice means a positive survival penalty at selection, not
necessarily imminent death. The low-instinct runs show that neglect has material
consequences. Aggregate risky-choice counts across evolving worlds are not a
controlled test of monotonic instinct response; the controlled fixtures provide
that comparison.

Observed pauses stayed within 12 through 28 ticks, and every natural stroll kept
the three-tile walked-path and endpoint caps. Unclassified intervals lasted at
most two ticks per Sim across all twelve runs; the trace includes completion and
decision transitions in this bucket rather than calling them frozen behavior.
Dead people are excluded from live candidate audits and identified in relationship
reports, allowing low-instinct runs to finish after a death.

Trace output reports decision need bands and actual integer-bucket probabilities,
aggregated per target and interaction. Duplicate waiting rows are summed within
each decision before averaging. Raw advertisement audits are explicitly labeled
as excluding instinct, survival risk and leisure appeal.

## Rendered play

Chrome ran the production preview on task-owned origin `127.0.0.1:49179` at
1280 by 900 and 390 by 844. Verified the rendered household advancing, Traits
showing the numeric value, Random selected by default, slider bounds 0 through
100, manual zero creation without a trait slot, and the same zero after Save and
Load through the player controls. The mobile form's slider, explanation and
buttons fit; the collapsed HUD leaves the household playable. Browser console
warnings and errors were empty at the final check.

Captured desktop, mobile housemate and mobile play screenshots in the task's
visualization output folder. The temporary viewport was reset and the task-owned
page closed in a finally block; the preview server was stopped. The owner then
authorized deployment after fresh-context review. The functional instinct text
is recorded in [player-visible-strings.md](player-visible-strings.md).

## Fresh-context review and integration

Two independent reviewers examined the implementation in fresh contexts against
the requested mechanics, save compatibility, verification requirements and code
standards. The standards review found two valid coverage gaps: migration ordering
was not tested with deliberately reordered storage, and new-game tests bypassed
the production seed wiring. Both now have causal regression tests, with intended
assertion failures under temporary mutations and passing byte-identical restored
source. This raises the targeted mechanism mutation count from eight to ten.

Both reviewers also checked the integration with main at `dac2f4de`, including
missing-station chains, unlimited queues, pre-voice save decoding and the revised
HUD. They reported no remaining actionable findings. Review did not substitute
for the combined-build checks below.

| Integrated command | Result | Exit |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=1` | PASS: 106 core, 267 data, 1 CLI, 680 simulation, 143 WASM; 1,197 total | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS | 0 |
| `npm test -- --maxWorkers=1` in `web/` | PASS: 86 files, 1,239 tests | 0 |
| `npm run typecheck` and `npm run build` in `web/` | PASS | 0 |
| Nine `trace.exe 12000 SEED INSTINCT` runs | PASS: exact prior hashes and counts for seeds 17/42/88, instinct 30/50/70 | 0 |

The integrated production preview passed at 1280 by 900 and 390 by 844.
The saved manual-zero person loaded with 0/100 in Traits, the household advanced,
New housemate still defaulted to Random, and manual zero fit the phone form.
Action cards coexisted with the controls. No browser warnings or errors appeared.
The page closed and the temporary viewport reset in a finally block; the owned
preview server was stopped. The ordinary-instinct balance rerun again recorded
zero deaths over 108,000 world ticks, with the same hashes as the table above.
