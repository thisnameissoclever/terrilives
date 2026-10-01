---
name: maintain-changelog
description: Update Natural Causes' public changelog whenever implementation changes significant player-facing behavior, controls, saves, art or sound. Apply before finishing such work; internal-only changes and read-only reviews do not require a release note.
---

# Maintain the Natural Causes changelog

Always update `docs/changelog/` after making a significant change players can notice, in the same branch and delivery as the implementation. Read [the format and publishing guide](../../../docs/changelog.md) before editing notes.

1. Write for players. Describe what they can do or notice in short, plain sentences. Include material limits. Omit internal refactors, implementation details, tests, CI, PR references and commit links. Keep development evidence in internal documentation, outside `docs/changelog/`.
2. Use one entry per date. Add same-day changes to the existing file, updating its title and summary to describe the whole update. Use a plain title, one brief summary and the sections New, Improved, Fixed, Art or Sound. Prefer one concise sentence per bullet; avoid repeating a bold headline in the sentence that follows. Do not rewrite earlier history except to correct an error or follow an explicit owner request.
3. Use the project writing direction. Functional text stays literal. Record implemented behavior only, with restrictions players need to know. Do not invent versions, release dates, approval, device acceptance or production status. Related changes on other branches belong to their owners.
4. Run `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`. The generator rejects development references and duplicate dates; still read every note as a player, since a word check cannot judge clarity. For page or link changes, inspect desktop and phone layouts in both themes, with dark as the default. For skill edits, preserve the byte-identical mirror in `.claude/skills/maintain-changelog/SKILL.md` and run the skill-mirror test.
5. Include the notes in the authorized delivery. GitHub Pages regenerates them after successful main CI; never edit generated `web/dist/changelog/index.html` as source. Confirm live publication only from an executed deploy step and the public page.

For an internal-only change, briefly state why it does not affect players when reporting the work. This skill is a maintenance obligation, not authorization to publish, merge, change unrelated copy or edit another project.
