# Published, regressed, and repaired scenes

`node scripts/character-creator-repair/compare-final.cjs` completed with exit 0: twelve scenario/version cases and no page or graphics diagnostics. Each version used isolated browser storage, the authored household, flat lighting, a 1600 by 1100 viewport, scale 2, and an asserted camera origin for each fixture. The script saved unused and active toilet, reading-chair, and bookcase views, plus the unused kitchen wall.

The published deployment was rechecked through GitHub's read-only deployment API: deployment `7025130307`, created `2026-10-12T22:13:54Z`, source `04160fe215fb8238e8b9aaff2f8493e7ff6a20d4`. The before version is the preserved built snapshot in `.scratch/creator-repair-before/dist`. The repaired version uses the local October 13 worktree. No published game or owner save was modified.

The camera and fixture positions match. Each version advances through its own normal command path to the requested active state; unrelated household activity and character poses can differ. The [receipt](receipt.json) records actual target identity, activity, facing, positions, and camera values.

## Inspected differences

1. The before toilet interaction has broken dark speckles and a bubble crossing the hair. These are absent in the corresponding published view. The repaired toilet retains its original smooth fixture artwork, with the bubble above the head.
2. The before occupied bookcase changes from its ordinary brown to an orange material. The repaired active case retains the original brown artwork and independently rendered stock. The character remains separate from the fixture.
3. The repaired reading chair keeps its original color and outline while the configured person reads. The bubble clears the hair in the inspected active view.
4. Kitchen wall clipping predates the creator: the published refrigerator's left edge and door details are interrupted where they meet the wall. The before build retains that defect. The repaired view shows the continuous front edge and handles. The inspected stove, sink, and counter boundaries also remain visible against the wall.

These observations come from the actual screenshots. They do not claim equality of complete frames, every animation phase, or every possible arrangement. Separate pixel-contract tests, all-facing interaction captures, and picking checks cover those mechanisms more directly.
