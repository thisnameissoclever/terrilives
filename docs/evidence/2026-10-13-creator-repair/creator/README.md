# Creator UI and draft verification

The creator now uses Identity, Appearance, Personality, Needs & habits, Interests & skills, Household, and Review. UI page scopes are independent of native patch groups. The wire schema is unchanged.

1. Appearance starts with Colors, Body, Style, Face, and Details collapsed. Each page retains its disclosure state. Gender uses Male/Female labels over the existing presentation values. Bald shares the hairstyle control and lock. Pronouns remain stored but are absent from the UI and randomization.
2. Global randomization chooses gender before an unlocked matching name. The existing 100-name pool retains its 40/40/20 editorial groups and adds male/female/either suggestion tags. Trait rolls select one through four traits when locks and available choices permit it. Manual empty selections remain valid.
3. Activity categories use explicit model/action mappings. Their displayed base value is the arithmetic mean of route weights, including absent weights as 1. Edits set all category routes in one transaction; undo and reset restore original sparse rows and float bits. Trait summaries average the actual route products. Hidden dish-cleaning weights survive randomization and preset application.
4. Review lists selected traits and hobbies, readable affinities, and decoded skill level/progress. Full trait selections leave checked traits removable and disable unchecked additions with an explanation. Locked fields disable their Random button.
5. Animation uses a private wall clock with Pause/Play, hidden-page and closed-dialog suspension, reduced-motion defaults, and serialized draws. Metadata supplies the current exported sample counts. The metadata has no duration field, so the preview declares one-second walking, 4.8-second reading, and four-second mopping cycles. These are preview demonstrations; mopping progress in gameplay remains simulation-owned. Nonappearance edits do not request an appearance redraw.

## Checks

Working directory: `D:\VIBES\.worktrees\5637\terrilives\web`.

1. PASS, exit 0: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npx vitest run tests/creator-repair.test.ts tests/creator-field-control.test.ts tests/creator-catalog-coverage.test.ts tests/creator-view.test.ts tests/character-draft.test.ts tests/character-fields.test.ts tests/character-choice-influences.test.ts tests/character-random.test.ts tests/character-session.test.ts --maxWorkers=1`. Result: 9 files and 33 tests passed. See `vitest.log`. Coverage includes the real WASM catalog, draft preservation, field interactions, disclosure persistence, and serialized preview lifecycle behavior.
2. PASS, exit 0: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/character/fields.ts src/character/draft.ts src/character/presentation.ts src/ui/character-creator/field.ts src/ui/character-creator/clock.ts`. No diagnostics. This is a scoped check; full application type checking and build belong to the integration pass.
3. Browser pixels, renderer performance, and native command acceptance are outside this worker's verification. The coordinating agent owns those checks. Unit tests do not establish visual acceptance.

## Follow-up after actual browser review

The review found that mobile grid rows compressed the navigation to its scrollbar while long editor content overflowed. Mobile content now uses a scrolling flex column with a nonshrinking, horizontally scrollable sticky navigation row. Preview and editor content follow in normal flow. Preview controls use separate label, control, facing, and sample spacing; the renderer owns portrait framing.

The trait cap warning now appears once at the group level when the limit is reached. Trait descriptions remain unchanged, and disabled additions reference the shared reason through `aria-describedby`. Numeric controls show editable ranges and compact percent, hour, or multiplier units where applicable. Review uses the same units. Identity and sleep timing each have one visible heading. Activity preference and hobby explanations appear once per group and avoid route/tag terminology.

1. PASS, exit 0: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npx vitest run tests/creator-field-control.test.ts tests/creator-view.test.ts tests/creator-repair.test.ts --maxWorkers=1`. Result: 3 files, 19 tests passed. See `ui-followup-vitest.log`. This includes cap counts from zero through four, unchanged trait descriptions, accessible cap reasons, numeric units/ranges, duplicate-heading checks, and existing draft preservation behavior.
2. PASS, exit 0: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/character/fields.ts src/character/presentation.ts src/ui/character-creator/field.ts`. No diagnostics.
3. PENDING: the coordinating agent's actual browser re-review of mobile navigation and preview spacing. Unit tests do not prove rendered layout.
