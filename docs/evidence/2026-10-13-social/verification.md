# Social interaction verification, 2026-10-13

Scope: issues #245, #246 and #247. Base revision:
`04160fe215fb8238e8b9aaff2f8493e7ff6a20d4`.

## Visual references

`released-world.png` records the published game with neutral lighting.
`bubble-preview.png` compares the revised circular conversation artwork with
existing activity bubbles at normal scale. The conversation art reuses the
linen and ink palette and existing activity glyphs, with a smaller outlined
thumb. It adds no font or external asset dependency.

The published version 8 save fixture and its provenance are recorded in
`web/tests/fixtures/released-v8-social.md`. The fixture was created from a
new starter household through the production Save control.

## Completed local checks

| Command | Result | Exit |
| --- | --- | --- |
| `python -B -m unittest discover -s assets/sprites/gen -p test_conversation_icons.py` | PASS: distinct speech, activity and reaction regions; both reactions; circular corners | 0 |
| `python -B -m unittest discover -s assets/sprites/gen -p test_architecture_extensions.py` | PASS: 10 tests, including rejection of changed history and undeclared or duplicate extensions | 0 |
| `python -B -m unittest discover -s assets/sprites/gen -p test_activity_icons.py` | PASS: 3 existing activity-art tests | 0 |
| `python assets/sprites/gen/build.py` | PASS: 30,927 sprite records and the architecture suffix generated | 0 |
| `python assets/sprites/gen/build.py --check` | PASS: architecture and atlas are up to date | 0 |
| `python docs/evidence/2026-10-13-social/check-generated-art.py` | PASS: every original sprite's metadata and decoded pixels preserved; architecture changes only its base and record IDs by 40 | 0 |
| `npm --prefix web test -- --maxWorkers=1 tests/conversation-bubbles.test.ts` | PASS: 2 tests for topic/reaction selection and bounded tint | 0 |
| `npm --prefix web test -- --maxWorkers=1 tests/save-worker.test.ts tests/persistence-controller.test.ts -t '^(?!.*stores the current simulation)'` | PASS: 82 tests; the real simulation storage test was explicitly excluded until the new WebAssembly build exists | 0 |
| `node --test scripts/build-changelog.test.mjs` | PASS: 12 tests | 0 |
| `node scripts/build-changelog.mjs` | PASS: public notes generated | 0 |
| `python check-doc-ids.py` | PASS: unique document identifiers | 0 |
| `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` | PASS: 24 workflow and change-classification contract tests | 0 |
| `cargo fmt --all -- --check` | PASS | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | 0 |
| `cargo test --workspace -- --test-threads=2` | Initial run: 1,849 core, content and simulation tests passed; four outdated WebAssembly test expectations failed and were corrected without changing production code | 101 |
| `cargo test -p terri-wasm --lib -- --test-threads=2` | PASS: all 266 boundary tests, including the four corrected current-format expectations | 0 |
| `cargo test -p terri-wasm --release --lib -- --test-threads=2` | PASS: all 266 boundary tests in the optimized build | 0 |
| `cargo test --workspace --doc` | PASS | 0 |
| `cargo tree -p <crate> --target <target>` | PASS: terri-core, terri-data and terri-sim contain no web dependencies on Linux or wasm32 targets | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS: optimized browser simulation, including the seated-reading save fix | 0 |
| `npm --prefix web run typecheck` | PASS | 0 |
| `npm --prefix web test -- --maxWorkers=1` | PASS: 2,269 tests across 186 files | 0 |
| `npm --prefix web run build` | PASS: game, WebAssembly and public changelog produced | 0 |

The version 8 backup regression test first failed against the previous worker
with `ok: false` instead of `ok: true` (exit 1). After updating the current
version and backup table, it passed (exit 0). The previous worker fixture is
byte-identical to the pre-change browser worker and refuses the new save.

`check-icon-mutations.py pixels` and `check-icon-mutations.py dimensions`
remove their respective validation rules in isolated Python processes. Each
produced one `ValueError not raised` test failure, with no import or setup
errors. The harness confirmed unchanged source bytes and exited zero. The
normal icon suite passed afterward. Logs record both rejected mutations.

`check-generated-art.py --mutate-pixel` changes one decoded floor pixel in
memory. It failed with `AssertionError: floor` (exit 1). The unchanged real
artifact comparison then passed again. No source image or atlas file was
modified by that negative check.

## Mutation and independent review

The isolated arithmetic sweep tested all 20 selected `benefit` and
`topic_weight` mutations: all were caught, with no survivors or timeouts.
The command used `--gitignore=true --jobs 1 --jobserver-tasks 2
--cargo-arg=--lib --test-workspace false` and the `social_episode::tests`
filter. `numeric-mutations.json` records every outcome. The reviewed source
digest remained unchanged.

`social-mutations.json` records nine manual lifecycle deletions. Each named
regression failed, and the runner verified exact restoration of every changed
production file. The four failure logs retain the assertions.

Independent adversarial review found missing field-level hash coverage. The
replacement tests perturb each saved social field separately and pin framing
with an independent known digest. An isolated `replace hash with ()` mutation
made all 20 field checks and the digest check fail; the unmodified 41-test
module passed. See `hash-mutation.json` and `hash-deletion-failures.log`.

Browser integration found a seated-reading save that used the presentation
chair instead of the book journey's origin. The fix preserves the canonical
origin without relaxing validation. The unchanged historical seated-reader
fixture now reloads through the current format and continues with matching
world hashes. Bypassing the fix fails with `InvalidEntityReference`; see
`reading-origin-mutation.log`. The follow-up independent review found no
remaining defect in this fix.

These are targeted mutation checks, not a complete repository mutation sweep.
The unrelated model-authoring suites were not rerun; all existing atlas pixels
and metadata were independently compared, and the complete generator check
passed. Remote CI and review are skipped under the owner's delivery instruction;
the Pages build and deployment remain required.

Native debug coverage is complete across the workspace run and the corrected
WebAssembly test run: 2,115 tests passed in total. The initial workspace log is
retained as `workspace-before-envelope-fixture-fixes.log`; its final four
failures concern test expectations for the current envelope, not unresolved
runtime failures. Frozen historical fixtures and strict malformed-save checks
remain in the suite.

## In-game verification

`conversation-world.png` and `conversation-world-zoomed.png` show the actual
game at two camera scales. The bubbles retain circular linen-and-ink styling,
with separate speech, topic and smaller reaction symbols. The captured pair
shares topic 19 with preferences 1 and -0.55, showing green approval and muted
red disapproval in the same conversation.

The disposable browser context verified exact conversation save restoration,
then used the real Save, Load and Load game controls to restore the saved world
after 25 additional ticks. The stored header identifies version 9. No page
errors were reported. `browser.json` records the values. The browser context
was closed in cleanup, and its preview server was stopped.

The changelog was also checked at 1280 by 900 and 390 by 844 in both themes.
The current entry is expanded and readable, with no horizontal overflow.
The four `changelog-*.png` captures record those layouts.
