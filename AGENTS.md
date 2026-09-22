# Project writing instructions

When writing, rewriting, editing, reviewing, or proposing human-readable text for Natural Causes, read and apply [.agents/skills/natural-causes-writing-style/SKILL.md](.agents/skills/natural-causes-writing-style/SKILL.md), including for short labels and project discussions. Apply it alongside the global `my-writing-style` and `unslop` skills when available.

Clarity always comes first. Keep object types primary, model names secondary, and flavor text optional to recognizing or using an object. Functional controls stay literal. Use sardonic wit, cynicism, and silliness only where they preserve comprehension. Existing game copy is not a style reference.

The skill records writing direction and a proposed object-text hierarchy. It does not authorize an unrequested rewrite, implement the proposed interface, or approve sample copy for release. Preserve the owner's review boundary documented in `docs/player-visible-strings.md` and lesson L58 in `docs/lessons-learned.md`.

## Finish delivery without waiting for duplicate CI

When the owner authorizes commit, push, and merge, complete that delivery. If the relevant tests, type checks, lint, and builds have already passed locally for the changes being merged, do not wait for the same remote CI checks to finish before merging. Do not rerun passing checks without a new change, failure, or specific unresolved concern.

State which checks passed locally and which remote checks are pending. A full remote mutation sweep is additional evidence, not the same as local unit tests or targeted mutation checks; describe that difference accurately. If the owner explicitly directs a merge with a remote check still pending, proceed without asking again or continuing to wait. Address known failures and enforced repository protections explicitly; never report a pending check as passed.

After merging, verify the PR state, synchronize this checkout with remote main, and leave a clean working tree. Report automatic deployment separately. Do not turn monitoring duplicate post-merge CI or deployment into another delivery gate unless the owner requested live verification or a specific release rule requires it.

## Clean up browser verification

Close task-owned game pages in a finally block after browser verification. Stop task-owned preview servers when finished. Do not leave audible game instances running during CI waits or after reporting completion, and do not close another task's pages or servers.
