# Creator mutation checks

`python scripts/character-creator-repair/check-draft-mutations.py` completed with exit 0. The baseline and restored checks passed. All four deliberate faults were rejected by behavioral assertions:

1. Removing field-lock protection changes a locked appearance selection.
2. Dropping the random-state restore breaks undo and deterministic continuation.
3. Submitting unchanged save groups breaks preservation of unrelated stored values.
4. Preventing the draft generator from advancing breaks its seeded continuation contract.

The script copied source and tests into `.scratch/creator-repair-validation`. It refused a linked source directory, used one Vitest worker with a 4 GiB heap limit, restored each copied file exactly, and checked that every corresponding live source hash remained unchanged. No fault was served by the live game.

The [receipt](receipt.json) records commands, exit codes, rejected faults, and source hashes. Individual logs retain the assertion failures. Browser behavior, save compatibility, and actual graphics recovery are checked separately in the creator review.
