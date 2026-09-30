# Compact HUD implementation evidence

Verified locally on 2026-09-30. Final checks include main through `7b23f9c0`
(sleep schedules and chair artwork). Screenshots record the HUD before those
independent art/simulation updates; the shell code is the same. Contract: [CUI-world]-[CUI-build] in
[the control layout specification](../../../specs/2026-09-30-control-layout-studies.md).

## Rendered checks

The local WebGPU game rendered without console warnings or errors. Checks used
1280 by 800, 390 by 844, 320 by 568, 844 by 390 and 240 by 320 viewports.
The normal desktop dock measured 89px tall; the phone dock measured 104px.
Traits was closed on fresh load. Existing saved game loading also succeeded.

1. Selected each Sim through the existing roster; opened Overview, People,
   Traits, Queue and Household. All seven meters and mood/career information
   remained available, including from collapsed desktop Overview.
2. Toggled Queue mode, inspected Clear orders and action preview, and opened
   New housemate. Escape closed its modal first and returned focus to New
   housemate; a second Escape closed the sheet and returned to Sim details.
3. Opened Options and inspected Light, Death, Sound, Effects, Save, Load, New
   game and Help. Keyboard Enter on Sim details closed Options without any
   pointer event. Close Options supplies a direct phone dismissal control.
4. Exercised all five Build tools. Selected and rotated an armchair, then
   cancelled through the floating placement controls in short landscape.
   Resized during Build and verified the prior Traits panel was restored on
   exit. Speed stayed hidden in compact Build; focus returned to Build.
5. Injected read-only bridge projections in the local diagnostic page for two
   non-selected household members approaching death. Complete warnings stayed
   visible after collapse and after selection became null. With warnings at
   844 by 390, the dock grew to 126.2px and the sheet stayed inside the viewport
   (top 7px, Close top 14px). These are UI fixtures, not new death-simulation tests.
6. Injected critical hunger/energy projections and verified the collapsed phone
   row read `Critical: hunger, energy`. Doubled computed text sizes at 320 by 568;
   panels scrolled, Close and New housemate remained reachable, and the page
   had no horizontal overflow. At 240 by 320, Queue and Clear orders remained
   accessible; the sheet top was 7px and the dock bottom 312px.
7. Reloaded to remove every projection/text override. Closed the task-owned
   page in a finally block, reset viewport emulation and stopped the preview
   server. No test override changes saved simulation state.

## Screenshots

1. [Desktop default](desktop-1280.png)
2. [Phone default](phone-390.png)
3. [Phone details](phone-details.png)
4. [Landscape with warning fixtures](landscape-warnings.png)
5. [Collapsed, no selection, warning fixtures](collapsed-no-selection-warnings.png)
6. [Collapsed critical-needs fixture](phone-critical-collapsed.png)
7. [Phone with doubled text and warning fixtures](phone-text-200.png)

## Automated checks

All commands below exited 0 unless a deliberate mutation is explicitly named.

| Check | Command | Result |
| --- | --- | --- |
| Rust formatting | `cargo fmt --all -- --check` | PASS |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| Rust tests | `cargo test --workspace` | PASS, 1208 tests |
| Web types | `npm --prefix web run typecheck` | PASS |
| Web suite | `npm --prefix web test -- --maxWorkers=1` | PASS, 1263 tests |
| WASM | `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| Production web bundle | `npm --prefix web run build` | PASS |
| Documentation ids | `python check-doc-ids.py` | PASS |
| Change classifier | `python -B -m unittest discover -s .github/scripts -p test_changes.py` | PASS, 11 tests |
| Asset tests | `python -B -m unittest discover -s <suite> -p 'test_*.py'` | PASS, 193 tests across sprites/gen and models/sims/sim-01, furniture, kitchen, bathroom, bedroom, office, dining |
| Atlas reproducibility | `python assets/sprites/gen/build.py --check` | PASS, 1254 sprites, 4096x8022 |
| Core dependency purity | `cargo tree -p <crate> --target <target>` | PASS for core/data/sim on Linux and WASM; each command succeeded before its output was checked for web crates |
| Whitespace | `git diff --check` | PASS |

Nine deliberate mutations were caught by the relevant focused Vitest suites:
Build snapshot deletion, collapsed-meter relocation deletion, object-menu
Escape-priority deletion, keyboard Options coordination deletion, production
warning-wiring deletion, illegal flex in the new compact stylesheet, illegal
Build hidden-state override in that stylesheet, placement right-escape
deletion and queue-capacity invalidation deletion. Each mutated test run exited 1.
Each original file was restored in finally and checked byte-for-byte by SHA-256
before the final passing suite. Actual failure excerpts are in
[mutations.txt](mutations.txt). This is targeted local mutation evidence;
the full remote Rust mutation sweep is separate.

## Adversarial review

Two independent read-only reviews challenged control reachability, CSS guard
coverage, keyboard/pointer parity, warnings, focus, responsive Build ownership
and the data boundary. Findings were fixed and re-reviewed: hidden non-selected
death warnings, keyboard opening both surfaces, guards missing the new CSS,
coarse-pointer dimensions, dynamic sheet height, mobile Help routing and stale
string inventory. Final source review reported no remaining implementation
blockers. The rendered checks above close its outstanding geometry checks.
Deployment verification is reported separately from these local checks.
