---
name: maintain-changelog
description: Review and update Natural Causes' player-facing changelog before every branch push and merge, including follow-up fixes. Use when implementing gameplay, controls, saves, accessibility, art, sound or other noticeable changes, and when choosing between an existing dated entry and a new one. Internal-only work needs a reason, not a public release note.
---

# Maintain the Natural Causes changelog

Apply before every branch push and again before merging. Read [the authoring and publishing guide](../../../docs/changelog.md), including its significance table, entry decision table and pre-push checklist. Keep notes committed and pushed on the same branch as the behavior they describe.

1. Review the full branch change and follow-up work since the previous push. Map each significant result a player can do, see, hear or rely on to a changelog bullet. An existing note does not automatically cover later changes. For internal-only work, explain the omission in the delivery report or pull request; do not add developer housekeeping to public notes.
2. Use one file per intended delivery date. Extend that date's existing entry, even for a different feature; create a new dated file only when none exists. Refine the same draft bullet for unshipped follow-up fixes. A later-date change to shipped behavior belongs in the later date's entry. Correct an inaccurate published note in place; do not rewrite true history.
3. Recheck the date before merging. When delivery moves, move only this branch's unpublished bullets to the correct entry. Reconcile other branches' same-day notes without losing their contributions or creating duplicate dates. Preserve published filenames and shared links as described in the guide.
4. Write for players: a concrete title, short summary and only relevant New, Improved, Fixed, Art or Sound sections. Use one player-visible result per bullet, ordinary language and actual control labels. State material limits and save consequences. Omit PRs, commits, tests, CI, implementation details, unsupported claims and unfinished features. Apply the project writing skill. Keep development evidence outside `docs/changelog/`.
5. Run `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`. Read the resulting copy for relevance and accuracy; the generator cannot infer missing player-facing changes. Confirm the source notes are included in the commits being pushed. Complete the pull-request changelog checklist, linking the entry or giving the internal-only reason.
6. For page or link changes, inspect desktop and phone layouts in both themes, with dark as the default. For skill edits, preserve the byte-identical mirror in `.claude/skills/maintain-changelog/SKILL.md` and run `npm --prefix web test -- --maxWorkers=1 tests/agent-skill-mirrors.test.ts`.
7. Include the notes in the authorized delivery. GitHub Pages regenerates them after successful main CI. Never edit generated `web/dist/changelog/index.html` as source. Confirm publication only from an executed deployment step and the public page.

Read-only reviews do not require a new public note. This skill is a maintenance obligation, not authorization to push, merge, publish, edit another branch or change unrelated copy. These instructions and the pull-request checklist require agent judgment; they do not install a Git pre-push hook.
