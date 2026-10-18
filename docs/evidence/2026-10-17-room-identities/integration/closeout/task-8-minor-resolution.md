# Task 8 minor review correction

Resolved the sole Minor finding from the approved R8 review. `docs/glossary.md` now identifies Build mode's Buy destination without a brittle tool ordinal. Surrounding behavior and identifiers are unchanged.

Commit: `d3c5f58e26bcaaa065a9c87fe663fca9dcd8bdeb` (`Refer to Buy by label in the glossary`). The commit changes that one glossary line only.

`python check-doc-ids.py` and `git diff --check` pass. The glossary is outside the final game-input manifest, so the accepted 3732-test, native, typecheck and build gates were not repeated. No runtime, test, public-note, dependency, browser or server change occurred. No push or merge was performed.

Final HEAD and a clean index/working tree are verified after this handoff is written. Source, index and heavy-command ownership are explicitly released to the parent; no later cleanup or evidence commit remains pending.

**Next steps**: Parent verifies the correction in final whole-branch review and owns delivery.
