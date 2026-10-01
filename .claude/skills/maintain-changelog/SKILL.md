---
name: maintain-changelog
description: Update Natural Causes' public changelog whenever implementation changes significant player-facing behavior, controls, saves, art or sound. Apply before finishing such work; internal-only changes and read-only reviews do not require a release note.
---

# Maintain the Natural Causes changelog

Always update `docs/changelog/` after making a significant change players can notice, in the same branch and delivery as the implementation. Read [the format and publishing guide](../../../docs/changelog.md) before editing notes.

1. Describe what the player can do now, what changed, or which visible failure was corrected. Include material limits. Record implemented behavior only; design docs and merged foundations do not prove the full feature exists.
2. Add a dated, uniquely named Markdown entry or update the current task's unpublished entry. Use the delivery date, a plain title, one summary paragraph and the documented change sections. Do not rewrite earlier entries unless correcting a verified error. Related changes on other branches belong to their owners.
3. Use the project writing direction. Functional text stays literal. Do not invent versions, release dates, approval, device acceptance or production status. Add PR or commit links when available.
4. Run `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`. For page or link changes, run the relevant web checks and inspect the result in a browser. For skill edits, preserve the byte-identical mirror in `.claude/skills/maintain-changelog/SKILL.md` and run the skill-mirror test.
5. Include the notes in the authorized delivery. GitHub Pages regenerates them after successful main CI; never edit generated `web/dist/changelog/index.html` as source. Confirm live publication only from an executed deploy step and the public page.

For an internal-only change, briefly state why it does not affect players when reporting the work. This skill is a maintenance obligation, not authorization to publish, merge, change unrelated copy or edit another project.
