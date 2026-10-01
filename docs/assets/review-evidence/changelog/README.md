# Changelog verification

The change adds a static public update history, a Changelog link below New game and Help in Options, and mirrored agent guidance. The page is generated from 25 dated Markdown entries, including historical backfill through PR #191. Pending bed assignment, Edit Sims, domestic-meal work and held audio work are excluded.

## Automated checks

1. `node --test scripts/build-changelog.test.mjs`: seven tests pass. They cover source additions, edits and deletions, ordering, initial disclosures, escaped source HTML, HTTPS links, malformed entries, literal template markers and the CLI's generated artifact.
2. `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`: 23 tests pass. Real temporary Git histories prove that new notes require publication, an untested game change still requires game CI, and unrelated documentation after tested notes can skip publication.
3. `npm --prefix web run typecheck`: passes.
4. `npm --prefix web test -- --maxWorkers=1`: all 1,760 tests across 117 files pass after integrating PR #191, including Options and the mirrored skill inventory. The run used a 1,024 MB Node heap limit.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: passes.
6. `npm --prefix web run build`: passes. The output includes `dist/index.html`, the WASM package and `dist/changelog/index.html` (58.23 kB before compression).
7. `python check-doc-ids.py` and `git diff --check`: pass.
8. Skill frontmatter validation passes for `.agents/skills/maintain-changelog`. The other discovery copy is byte-identical.
9. `cargo test --workspace -j 1 --quiet`: all 1,256 native tests pass after integrating main through PR #190. `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -j 1 -- -D warnings` pass.
10. The seven asset suites pass. After integrating PR #190, the sprite suite passes all 122 tests and `python assets/sprites/gen/build.py --check` confirms the 1,392-sprite atlas matches its generator.

## Browser and fault checks

1. The desktop and 390-pixel phone screenshots show the final 25-entry build with two entries initially open and no horizontal overflow. The earlier 320-pixel layout check also passed. Keyboard disclosure controls, Expand all, Collapse all, the theme preference and permalink reload were checked in the browser.
2. Options places the full-width Changelog link beneath both New game and Help. The browser engine emits `Page.windowOpen` with the expected local project's `/changelog/` URL, `windowName=_blank` and `userGesture=true`; see `link-activation.json`. Loading that destination directly shows the Changelog heading and all 25 entries. The in-app browser did not expose the requested popup in its tab inventory, so activation and destination rendering are verified separately; a visible popup in that host is not claimed. The game was checked on a disposable localhost origin to avoid saved households; task-owned game tabs and the preview server were closed afterward.
3. `faults.json` records five deliberate fault checks. Removing the published-note classification, using the game baseline for notes, removing HTML escaping, ignoring the changelog CI job or ignoring notes in the stale-artifact guard each causes the intended assertion to fail. Original bytes were restored and the tests passed afterward.

The full remote Rust mutation sweep is additional coverage and is not represented by these local checks. Live Pages publication requires the implementation on main, successful main CI and an executed deployment step.
