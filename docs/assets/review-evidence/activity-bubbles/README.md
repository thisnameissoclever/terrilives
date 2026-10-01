# Activity bubble review, 2026-10-01

Every shipped ordinary interaction and dinner work step now has an authored
activity bubble. All 22 displayed symbols were reviewed for meaning, centering,
contrast, border clearance and legibility. The independent reviewer approved
the complete pairing inventory and production captures without blocking findings.

The exact pairing table is in
[`2026-10-01-activity-bubbles.md`](../../../specs/2026-10-01-activity-bubbles.md).
The 19 ordinary interactions include both beds, both reading routes, all three
sitting routes, shower, toilet, bath, television, radio, correspondence,
dishwashing, handwashing, exercise, aquarium watching, snack and couch lying.
Four dinner stages distinguish ingredients, preparation, cooking and eating.
Walking, reserved conversation waiting and conversation complete the 26 live
scenarios. Blocked object waiting has a focused simulation test. Generic gear
art was reviewed separately; no shipped valid interaction requires that fallback.
Idle people have no active task, and off-lot workers have no visible head.

## Retained visual evidence

1. [`icon-contact-sheet.png`](icon-contact-sheet.png): all 22 glyphs, with the
   revised existing artwork beside the new activity symbols.
2. [`production-pairs-night.png`](production-pairs-night.png) and
   [`production-pairs-flat.png`](production-pairs-flat.png): every live pairing
   captured from the release WebGPU canvas at camera scale one. Both use the
   actual activity projection and body presentation, with night or neutral light.
3. [`production-pairs.json`](production-pairs.json): expected activity, target,
   action queue, tick, position and body-action receipts for all 26 scenarios.
4. [`production-shower-night.png`](production-shower-night.png): shower use
   started through the ordinary object menu in the displayed production game.
5. [`production-shower-zoom.png`](production-shower-zoom.png) and
   [`production-minimum-zoom.png`](production-minimum-zoom.png): the same scene
   through actual player camera zoom, including the minimum scale.

The independent visual review approved every ordinary pair, each dinner stage,
walking, waiting and talking in both contact sheets. The production zoom pass
also approved placement above the displayed head, silhouettes and centering.
The fish and bicycle were specifically checked as improvements over the old art.
The dining-table action is sitting despite its historical menu label; real
meal eating is the terminal dinner step. No unrelated menu copy was rewritten.

The reproducible scenario driver is [`activity-bubbles.js`](../../../../web/proofs/activity-bubbles.js).
It uses a task-owned production stress page, restores its initial in-memory
snapshot in `finally`, and writes no game save. Review pages were closed,
temporary lighting was restored, and task-owned preview servers were stopped.
No browser warning or error was observed during the pairing pass.

## Local validation

Each command below exited zero. The final web checks include the independently
merged door-audio and dock-layout changes on main at `70f56b6e`. Captures precede
the dock-layout merge; its changes do not alter the reviewed icon renderer.

| Command | Relevant output | Verdict |
| --- | --- | --- |
| `cargo test --workspace` | 1,256 tests passed across native suites; doc tests passed | PASS |
| `cargo fmt --all -- --check` | No formatting differences | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | Finished successfully | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release WASM package built | PASS |
| `npm --prefix web test -- --maxWorkers=1` | 115 files, 1,752 tests passed | PASS |
| `npm --prefix web run typecheck` | `tsc --noEmit` succeeded | PASS |
| `npm --prefix web run build` | 86 modules transformed; production build succeeded | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 122 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/sims/sim-01 -p 'test_*.py'` | 26 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/furniture -p 'test_*.py'` | 30 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'` | 15 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | 8 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'` | 13 tests passed | PASS |
| `python -B -m unittest discover -s assets/models/office -p 'test_*.py'` | 8 tests passed | PASS |
| `python assets/sprites/gen/build.py --check` | Atlas up to date: 1,392 sprites, 8192 by 4806 | PASS |
| `python check-doc-ids.py` | Documentation IDs are unique and allocation-free | PASS |
| `git diff --check` | No whitespace errors | PASS |
| `cargo tree -p {crate} --target {target}` for core, data and sim on `x86_64-unknown-linux-gnu` and `wasm32-unknown-unknown` | All six trees contain no web dependencies | PASS |

The atlas prefix test pins the names, decoded pixels, dimensions and density
of all 1,370 historical records. Revised and new runtime icons append at
indices 1370 through 1391. No public save schema, bridge column, simulation
hash input or structural content fingerprint changed. Internal compiled-pack
golden bytes deliberately include the new optional metadata; those packs are
generated and embedded together by the same build, rather than stored as saves.

## Deliberate regression checks

Ten Rust mutations were caught by assertion failures: removing required
metadata, exact ordinary identity, chain station-role identity, ordinary
activity mapping, chain activity mapping, body-action precedence or blocked
waiting; hashing ordinary or chain activity metadata; and misclassifying TV
in the compiler vocabulary. Each changed source was restored byte for byte,
and the focused unmutated suites passed after restoration.
Exact commands, assertion excerpts, exit codes and restoration hashes for the
isolated fixtures are retained in [`rust-mutations.json`](rust-mutations.json).

Two additional mutations exercise the renderer and art geometry. Removing
the shower sprite fails the activity-12 frame test with `expected 1 to be 2`.
Moving the fish tail onto the rim fails the geometry test with `2.0 not less
than or equal to 1.5`, as well as the shared circle-boundary check. Both test
commands exit 1 when mutated. Restored frame/HUD tests pass all 120 cases,
and restored icon tests pass all three cases. Exact commands, exit codes and
restored SHA-256 values are in [`web-art-mutations.json`](web-art-mutations.json).

These focused demonstrations are additional local evidence. They do not claim
that the full remote `cargo mutants` sweep has completed, or establish public
deployment. The owner authorized delivery after local checks and independent
pairing review; remote checks and automatic Pages deployment are reported
separately in the delivery message.
