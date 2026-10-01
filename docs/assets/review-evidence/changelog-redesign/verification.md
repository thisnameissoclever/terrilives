# Changelog redesign verification

The owner selected the compact accordion mockup and requested dark and light themes, with dark as the default. The implementation retains the game's Options link and automatic Pages publication. Public notes now describe player-visible changes, with same-day updates consolidated and historical links preserved.

## Local checks

| Command | Result | Exit |
| --- | --- | --- |
| `node --test scripts/build-changelog.test.mjs` | PASS: 12 tests | 0 |
| `node scripts/build-changelog.mjs` | PASS: 22 dated updates rendered | 0 |
| `npm --prefix web run typecheck` | PASS | 0 |
| `npm --prefix web test -- --maxWorkers=1` | PASS: 118 files, 1,770 tests, including skill mirrors | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS | 0 |
| `npm --prefix web run build` | PASS: game and standalone changelog | 0 |
| `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` | PASS: 23 workflow and classifier tests | 0 |
| `python -B check-doc-ids.py` | PASS: unique documentation ids | 0 |
| `python -B assets/sprites/gen/build.py --check` | PASS: 1,700 sprites, atlas up to date | 0 |
| `cargo fmt --all -- --check` | PASS | 0 |
| `cargo clippy --workspace --all-targets -j 1 -- -D warnings` | PASS | 0 |
| `git diff --check` | PASS | 0 |

The web commands used a 1,024 MiB Node heap limit. Native tests are separate from these recorded checks. Remote full mutation CI is also separate evidence and is not claimed as passed by this report.

## Deliberate faults

Each fault was applied individually. The Node test command failed with exit 1, the file was restored byte-for-byte, and the restored suite passed. Actual failures are saved alongside this report; `mutations.json` records the exit codes and restoration results.

1. Remove the public-copy validation call: `copy-guard.txt`, missing expected exception.
2. Disable the duplicate-date guard: `one-date.txt`, missing expected exception.
3. Open two updates initially: `latest-only.txt`, disclosure-state mismatch.
4. Follow a light system preference by default: `dark-default.txt`, light versus dark mismatch.
5. Remove containing-entry lookup for legacy links: `legacy-link.txt`, linked entry remains closed.
6. Disable legacy-identifier validation: `legacy-validation.txt`, malformed collection is not rejected with the required validation error.

## Browser evidence

The production build was exercised in the browser on October 1, 2026. Screenshots in this directory show the real page.

1. Desktop: 1280 px wide, dark and light screenshots. A fresh origin opened dark while the browser reported a light system preference. Switching to light and reloading retained light.
2. Phone: 390 px in both themes and 320 px in light. No horizontal overflow. Narrow closed rows wrap dates and titles cleanly.
3. Keyboard: Enter expands an individual entry. Expand all opens all 22 updates and moves focus to Collapse all; Collapse all closes them and returns focus to Expand all.
4. Historical link: `#2026-09-30-furniture-and-layout` opens the consolidated September 30 entry. Its link points to the stable `#update-2026-09-30` anchor.
5. Expanding the entire history exposes no PR, commit or GitHub references in visible text.
6. Options: Changelog follows New game and Help. Its relative URL resolves to `/changelog/`, with a new tab and `noopener`.
7. All task-owned tabs were closed in cleanup and the preview server was stopped.

No dependency or deployment-permission changes were made. Source HTML is escaped, HTTPS-only links remain enforced, and the page needs no external scripts, fonts or content requests. The copy guard catches common developer references; editorial review is still necessary for accuracy and relevance.
