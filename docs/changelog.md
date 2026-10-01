# Maintaining the public changelog

The public page is [Changelog](https://thisnameissoclever.github.io/terrilives/changelog/). Options contains a Changelog link beneath New game and Help. It opens a new tab so the current game stays open.

## Source and format

Every significant player-facing change must have a note in `docs/changelog/` in the same change as the implementation. Follow the [maintenance skill](../.agents/skills/maintain-changelog/SKILL.md). Include new controls or mechanics, changes to save behavior, visible or audible art changes, and fixes players can notice. Internal refactors, tests and CI edits need a note only when they change the player's experience.

Use one Markdown file per meaningful batch: `YYYY-MM-DD-short-slug.md`. Use the intended delivery date for new work. If delivery moves to a later date, update the filename before publication. Historical backfill uses the repository's recorded change dates and groups related merges; these dates do not claim a separately verified deployment time. The backfill covers merged changes through PR #191. Bed assignment's foundations are merged, but the assignment interface and two-person sleeping are still pending, so they have no released-feature note. Domestic meals have a separate delivery entry. Proposed Edit Sims, ambience and held audio work remain excluded.

Each file starts with one `# Title`, followed by one summary paragraph, then one or more of `## Features & changes`, `## Bug fixes`, or `## Art & sound`. Put changes in `- ` list items. Indented continuation lines are supported. Inline bold, code and HTTPS links are supported; raw HTML is escaped. Keep titles plain. Unsupported block structure, missing summaries, empty sections and invalid filenames fail the build.

```markdown
# Clearer furniture placement

Furniture placement shows why a position is unavailable.

## Bug fixes
- **Placement refusals explain the problem.** The preview identifies blocked access before you confirm the move.
```

Describe the player action and result. Preserve restrictions and distinguish implemented behavior from future plans. Add a PR or commit link when available; do not invent version numbers, approval, listening acceptance or publication evidence. Keep separate same-day batches in separate files with distinct slugs. The page sorts filenames newest first, with a deterministic slug order within a date.

## Generation and publication

`scripts/build-changelog.mjs` reads the Markdown and `web/changelog/` presentation files. The Vite plugin emits `changelog/index.html` during `npm --prefix web run build`. In development, `/changelog/` uses the same renderer and reloads when notes change. The generated page includes its CSS, script and all entries; reading it does not require WebGPU, an API, external fonts or runtime requests for Markdown. Native disclosures also work without JavaScript. Play links use `../` and the game link uses `./changelog/`, preserving GitHub Pages' project path.

CI's classifier reports `code` for game checks and `site` for published content. A changelog-only Markdown addition, edit or deletion sets `code=false` and `site=true`. The lightweight `changelog` job tests and renders the notes; Rust, web and mutation jobs can skip. Game changes still run their normal gates and the changelog check. Game comparisons continue to start at the newest main push whose web job passed, so an untested game change cannot disappear behind a later notes edit. Notes comparisons start at the newest successful main push whose changelog or web job passed. Keeping those histories separate lets unrelated documentation after a tested note still skip publication.

Pages runs after successful push CI on main and checks out that run's exact SHA. A successful `web` or `changelog` job enables the site build. The build includes the game and changelog in one Pages artifact. The deployment check compares all published content, including notes, with current main; a newer changelog makes an older artifact stale. Other Markdown documentation remains eligible for the existing no-deploy path.

Validate notes with `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`. The latter writes `web/dist/changelog/index.html` by default. Validate workflow routing with `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`. Validate the skill mirrors with `npm --prefix web test -- --maxWorkers=1 tests/agent-skill-mirrors.test.ts`. Use the regular web typecheck, suite and production build for presentation or game-link changes. Inspect desktop and phone layouts, a collapsed entry, a permalink, the theme control and the Options link. Close task-owned game tabs and preview servers afterward.

Publication happens after the implementation reaches main and main CI succeeds. A local build or a successful Pages workflow that skipped its deploy step does not establish that the page is live.
