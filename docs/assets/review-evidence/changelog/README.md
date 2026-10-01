# Changelog verification

The change adds a static public update history, a Changelog link below New game and Help in Options, and mirrored agent guidance. The page is generated from 24 dated Markdown entries, including historical backfill through PR #187. Pending bed assignment, Edit Sims, domestic-meal work and held audio work are excluded.

## Automated checks

1. `node --test scripts/build-changelog.test.mjs`: seven tests pass. They cover source additions, edits and deletions, ordering, initial disclosures, escaped source HTML, HTTPS links, malformed entries, literal template markers and the CLI's generated artifact.
2. `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`: 23 tests pass. Real temporary Git histories prove that new notes require publication, an untested game change still requires game CI, and unrelated documentation after tested notes can skip publication.
3. `npm --prefix web run typecheck`: passes.
4. `npm --prefix web test -- --maxWorkers=1`: all 1,715 tests across 114 files pass, including Options and the mirrored skill inventory.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`: passes.
6. `npm --prefix web run build`: passes. The output includes `dist/index.html`, the WASM package and `dist/changelog/index.html` (about 56 kB before compression).
7. `python check-doc-ids.py` and `git diff --check`: pass.
8. Skill frontmatter validation passes for `.agents/skills/maintain-changelog`. The other discovery copy is byte-identical.

The full remote Rust mutation sweep is additional coverage and is not represented by these local checks. Live Pages publication requires the implementation on main, successful main CI and an executed deployment step.
