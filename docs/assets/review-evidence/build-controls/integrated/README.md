# Integrated Build controls checks, 2026-10-01

The release checks used integration commit `faef9dd0`, which merged main `85e826ba`, plus the review corrections described below. [Source fingerprints](source-sha256.json) identify the inspected frontend bytes. The earlier [implementation evidence](../README.md) retains the original screenshots, repository checks and four deliberate mutations. The owner accepted the displayed implementation screenshots on 2026-10-01; physical-phone use and spoken screen-reader output remain unverified.

## Review and corrections

A fresh-context adversarial review found two actionable defects. Moving the Build panel between its desktop and compact hosts lost focus inside selectors, Shortcuts or Exit build. The panel now retains its focused descendant and avoids redundant moves. The Room shortcut reference described an extra Enter stage; it now matches the controller's two stages, with arrows moving the corner. Independent browser review confirmed all ten focus transitions for five controls across 701px/700px in both directions. The final review found no unresolved actionable findings.

Main's bed and social changes remain intact. The release notes extend the existing same-day entry without removing its earlier bullets. The title assertion changed with that entry's title.

## Checks

Commands ran from the repository root. Each listed command exited 0.

| Command | Result | Verdict |
| --- | --- | --- |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Rebuilt the merged release WebAssembly | PASS |
| `npm --prefix web run typecheck` | No diagnostics after rebuilding WebAssembly and correcting the test port's return type | PASS |
| `npm --prefix web test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile.json=<task-evidence>/integrated-web-final.json` | 1774 tests and 124 files passed; zero failed | PASS |
| `npm --prefix web run build` | Production game and changelog built; existing large-chunk advisory remains | PASS |
| `node --test scripts/build-changelog.test.mjs` | 12 tests passed | PASS |
| `node scripts/build-changelog.mjs` | Notes rendered successfully | PASS |
| `python -B -m unittest discover -s .github/scripts -p test_*.py` | 23 tests passed | PASS |
| `cargo fmt --all -- --check` | No formatting differences | PASS |
| `python check-doc-ids.py` | Unique, allocation-free documentation ids | PASS |
| `git diff --check` | No whitespace errors | PASS |
| `node scripts/verify-build-controls.cjs <task-evidence>/integrated-release` | 51 layout states, real actions and focus checks passed | PASS |

The browser command used the existing Playwright installation, `HEADED=1` and `GAME_URL=http://127.0.0.1:5234`. The [measurements](game-layout-evidence.json) retain control bounds, input ownership and unchanged-frame results. [Web summary](web-tests-summary.json) records the final suite counts. The [updated Help screenshot](implemented-help-shortcuts.png) shows the shared reference in the integrated game.

The first full web run overlapped this task's browser and production build. It exited 1 with four failures in atlas and legacy-save tests; the recorded case durations ranged from 6.3 to 37.8 seconds. All 18 tests in those two files passed immediately in isolation. The complete suite then passed with identical test and production sources and no overlapping task-owned build or browser. No timeout, retry or test-exclusion setting changed. The initial typecheck also ran before the merged WebAssembly build finished and saw missing generated bed/social exports; rebuilding supplied them. The changelog test's old title assertion was corrected after the same-day notes were consolidated.

No Rust, content, save-schema or dependency files differ from integrated main. The full Rust mutation sweep and repeated Rust/art checks were skipped as unrelated to the frontend diff, under the owner's delivery instruction. The earlier repository checks remain in the original dated record. Remote checks and GitHub review are not merge gates for this delivery; the owner explicitly authorized local verification and adversarial review instead.

## Focus mutation and cleanup

Deleting the focused-descendant restoration caused the browser assertion to fail with an empty active-element id instead of `builder-object`, exit 1. Restoring it passed, exit 0. [Mutation output](focus-mutation.log), [restored output](focus-restored.log) and [matching before/after SHA-256 values](focus-mutation.json) retain the evidence. An initial proof harness incorrectly waited for the furniture list before entering Build; its setup timed out in both states. The corrected harness waits for the startup catalogue and verifies the actual focus assertion.

All task-owned browser contexts closed in `finally`. The task-owned preview server on port 5234 stopped after verification; no listener remained. Other tasks' pages and servers were untouched. These local checks do not establish a live Pages deployment.
