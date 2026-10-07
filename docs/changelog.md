# Maintaining the public changelog

The public page is [Changelog](https://thisnameissoclever.github.io/terrilives/changelog/). Options contains a Changelog link beneath New game and Help. It opens a new tab so the current game stays open.

## Source and format

Every significant player-facing change must have a note in `docs/changelog/`, committed and pushed on the same branch as the implementation. Apply the [maintenance skill](../.agents/skills/maintain-changelog/SKILL.md) before every push, including follow-up fixes and conflict resolution. Do not defer notes until task completion or leave them uncommitted while pushing the implementation.

Use one Markdown file per delivery date: `YYYY-MM-DD-short-slug.md`. Use the owner's intended delivery date, or the current date in America/Los_Angeles when delivering now. The date groups updates; it is not a version number, commit date or assertion of an exact publication time. A note on an unmerged branch is draft release copy and must travel with the behavior it describes. Check the date again before merging. Historical backfill retains recorded change dates without claiming separately verified deployment times.

Each file starts with one `# Title`, followed by one short summary paragraph, then one or more of `## New`, `## Improved`, `## Fixed`, `## Art`, or `## Sound`. Put changes in short `- ` list items. Indented continuation lines are supported. Inline bold, code and HTTPS links are supported; raw HTML is escaped. Keep titles plain and avoid a repeated bold headline on every bullet. Unsupported block structure, missing summaries, empty sections, invalid filenames and duplicate dates fail the build.

```markdown
# Clearer furniture placement

Furniture placement shows why a position is unavailable.

## Fixed
- Furniture placement explains blocked access before you confirm the move.
```

Describe what players can do or notice. Preserve restrictions and distinguish implemented behavior from future plans. Never include PR references, commit links, test results, CI details or implementation terminology in public entries. Keep development evidence in internal documentation. Do not invent version numbers, approval, listening acceptance or publication evidence. The generator rejects common development references, but human review must still check relevance and accuracy.

## Decide whether a change belongs in the changelog

Ask what a player can do, see, hear or rely on after this change that they could not before. Include a note when that difference is material. File count is not the test: a one-line save fix may matter more than a large internal refactor.

| Change | Treatment |
| --- | --- |
| New or changed gameplay, controls, navigation or settings | Include the action and result, with relevant limits. |
| A noticeable bug fix, accessibility improvement, art or sound change | Include the symptom or visible difference and the resulting behavior. |
| Save compatibility, recovery, lost-progress prevention or a required player action | Include the consequence and instructions, identifying affected saves or situations. |
| Material loading, stability or performance improvement | Include the observable result only when supported by evidence. Do not invent speed claims. |
| Internal refactoring, tests, tooling, agent instructions or dependency maintenance with no player effect | Omit from public notes. Explain why in the internal delivery report or pull request. |
| Cosmetic typo or formatting adjustment | Usually omit. Include a correction to misleading instructions or another problem players need to know about. |
| Planned, incomplete, disabled or separately held work | Do not present it as available. Describe only the usable portion shipping with this branch and its relevant limits. |

## Update an entry or create one

Inspect the branch's notes and fresh main history before choosing a file. Related work on another branch is not yours to announce or edit. Do not create a second file for the same date to avoid a conflict.

| Situation | Action |
| --- | --- |
| The intended delivery date already has an entry | Add the change to that file, even for a different feature. Adjust the title and summary to describe the whole day's update. |
| No entry exists for that delivery date | Create one dated file with a short lowercase slug, title, summary and relevant sections. |
| A follow-up push refines the same feature before it ships | Update its draft bullet to describe the final behavior. Do not add an entry or repeated bullet for each push, commit, review fix or test run. |
| A follow-up push adds another significant player-visible result | Add a distinct bullet to the appropriate section of that delivery-date entry. |
| Unpublished work spans several days or delivery moves | Move only this branch's unpublished bullets to the intended delivery date. Rename a draft file only if all its content belongs to that unpublished delivery. Preserve published content and other contributors' notes. |
| A change to an already-shipped feature arrives on a later date | Use the later date's entry, creating it if absent. Explain the new behavior or fix; do not rewrite the earlier entry as though it had always worked that way. |
| A published note has a factual error, typo or broken link | Correct that note in place. A text correction alone does not create a release entry. Preserve true historical facts and shared links; broader history rewrites require the owner's request. |
| Two branches added notes for the same date | During integration, combine their unique player-facing changes into one file, preserving both contributions. Remove duplicate bullets and rerun validation. |

Keep existing filenames where practical. Preserve renamed published filename anchors in `web/changelog/legacy-anchors.json`. Additions on the same calendar date may extend an already-published entry. New behavior on a later date belongs to that later date.

## Write the entry

1. Use a concrete title and one brief summary covering the update. Avoid vague titles such as "Various improvements" and summaries that only repeat the title.
2. Choose only sections with content: New for a new capability, Improved for changed existing behavior, Fixed for a corrected problem, Art for visible artwork, and Sound for audio. Put each change in one section, not several.
3. Give each bullet one player-visible result. Name the control, object or situation players will recognize. Prefer a concise sentence; add another when a limit or required action needs explanation.
4. Use actual control labels and ordinary language. State material restrictions, save consequences and supported platforms where they affect use. Do not promise unfinished features or claim an unmerged branch is already published.
5. Combine internal fixes that produce the same player-visible result into one bullet. Avoid repeated bold headlines, promotional claims, technical identifiers, private details and development links. Humor is optional and must not obscure meaning.

These examples illustrate wording, not current defects or features:

| Weak or inappropriate | Player-facing wording |
| --- | --- |
| "Merged PR #123 to refactor queue dispatch." | "Queued actions keep their order after you load a saved game." |
| "Improved mobile UI." | "Build controls stay reachable on narrow phone screens." |
| "Added dining support." when sitting is unfinished | "Housemates gather at the table for shared meals. Seated dining is still to come." |

## Before every branch push and merge

1. Review the work being pushed, including follow-up commits since the previous push and the full branch change against current main. Identify each significant player-facing result. A changelog edit somewhere in the branch does not prove later changes are covered.
2. Map each result to a specific bullet in the correct dated entry. Add missing notes, remove duplicate or withdrawn draft claims, and preserve other contributors' notes. For internal-only work, record the reason in the internal delivery report or pull request, not the public changelog.
3. Read the entry as a player, check it against implemented behavior, and run the changelog tests and build listed below. Confirm material limits and required player actions are stated.
4. Confirm the notes are in the commits being pushed alongside the implementation. An unstaged file, draft response or promise to write notes later does not satisfy this requirement.
5. Before merging, refresh main and reconcile dates and overlapping entries. Recheck changed notes after conflict resolution. Complete the pull-request changelog checklist with the entry path or the internal-only reason.

The project `AGENTS.md`, discoverable maintenance skill and pull-request template repeat this obligation. The generator checks structure, duplicate dates and common development references. It cannot infer player impact or prove every feature has a truthful note. These are agent review requirements, not an installed Git pre-push hook or automatic semantic enforcement.

## Presentation and links

The owner approved the compact accordion design with both themes. Dark is the default, regardless of the device theme. The theme control saves a light or dark preference when browser storage is available. A blocked preference store does not prevent reading or switching themes. Only the newest update starts expanded. Older rows show their date and title; Expand all and Collapse all control the full history.

Each update has a stable `#update-YYYY-MM-DD` link. Opening a link expands the relevant entry. `web/changelog/legacy-anchors.json` preserves the original links from before same-day consolidation; retain those aliases when changing titles or filenames. Each current filename also gets an alias automatically. New entries do not need a legacy-list addition unless an already-published filename changes.

## Generation and publication

`scripts/build-changelog.mjs` reads the Markdown and `web/changelog/` presentation files. The Vite plugin emits `changelog/index.html` during `npm --prefix web run build`. In development, `/changelog/` uses the same renderer and reloads when notes change. The generated page includes its CSS, script and all entries; reading it does not require WebGPU, an API, external fonts or runtime requests for Markdown. Native disclosures also work without JavaScript. Play links use `../` and the game link uses `./changelog/`, preserving GitHub Pages' project path.

CI's classifier reports `code` for game checks and `site` for published content. A changelog-only Markdown addition, edit or deletion sets `code=false` and `site=true`. The lightweight `changelog` job tests and renders the notes; Rust, web and mutation jobs can skip. Game changes still run their normal gates and the changelog check. Game comparisons continue to start at the newest main push whose web job passed, so an untested game change cannot disappear behind a later notes edit. Notes comparisons start at the newest successful main push whose changelog or web job passed. Keeping those histories separate lets unrelated documentation after a tested note still skip publication.

Pages runs after successful push CI on main and checks out that run's exact SHA. A maintainer can also dispatch `pages.yml` after the relevant checks pass locally, providing the complete main commit as `validated_sha`. The manual route rejects another branch or a commit different from the workflow's main revision, then runs the same build, artifact verification and stale-release guard. This supports owner-authorized delivery without duplicate remote test gates. A successful `web` or `changelog` job enables the site build. The build includes the game and changelog in one Pages artifact. The deployment check compares all published content, including notes, with current main; a newer changelog makes an older artifact stale. Other Markdown documentation remains eligible for the existing no-deploy path.

Validate notes with `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`. The latter writes `web/dist/changelog/index.html` by default. Validate workflow routing with `python -B -m unittest discover -s .github/scripts -p 'test_*.py'`. Validate the skill mirrors with `npm --prefix web test -- --maxWorkers=1 tests/agent-skill-mirrors.test.ts`. Use the regular web typecheck, suite and production build for presentation or game-link changes. Inspect desktop and phone layouts in both themes, the dark default, saved preferences, individual and global disclosures, keyboard focus, current and old permalinks, and the Options link. Close task-owned game tabs and preview servers afterward.

Publication happens after the implementation reaches main and either main push CI succeeds or a maintainer dispatches the exact main revision after its relevant checks pass locally. A local build or a successful Pages workflow that skipped its deploy step does not establish that the page is live.
