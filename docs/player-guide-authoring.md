# Maintaining the player guide

Player-facing source lives in `docs/player/`. Edit its Markdown and metadata; generated HTML, search data and the numerical snapshot are derived outputs. The game, guide and changelog ship in the same Pages artifact. Changelog history keeps its public `/changelog/` addresses even though its source now lives in `docs/player/changelog/`.

## When behavior changes

1. Read the affected guide article and the relevant entries in `docs/player/effects.json` before editing documented gameplay or controls.
2. Update the article, effect mapping and affected desktop/mobile screenshots in the same branch. Name the visible control and the exact access path on each layout. Link related topics and UI entries to their stable subsections.
3. Review compiled reference changes with `node scripts/check-player-reference.mjs --refresh`. This command records review; it does not perform editorial review for you. Inspect the diff and adjust qualitative wording when a number, cap, requirement or timing changes. Never edit generated values by hand.
4. Run `node scripts/check-player-reference.mjs --verify-export` when gameplay, reference generation or generated data changes. This compares the snapshot with the current compiled content. Whole-file source fingerprints also catch helper and browser-boundary changes that leave numerical values alone.
5. If a source change has no player-facing consequence, record a specific reason in the pull request before refreshing the source review. Do not use a general statement such as "internal only" where a changed rule affects play.
6. Continue to add a separate player-facing changelog note for each significant delivered change. Read [changelog authoring](changelog.md) and use the maintenance skill before pushing.

## Writing and links

Write literal instructions and explain the consequence. Keep requirements, restrictions, costs and exceptions visible. Put optional exact values inside `:::numbers A descriptive label` and a closing `:::` line. A number token such as `{{number:tuning.days_per_season}}` reads the compiled reference; it must resolve to a finite number. Every displayed value needs a unit and an explanation of whether it is a rate, reference total or completion reward.

Use `## Heading {#stable-id}` and `### Heading {#stable-id}`. Link another guide page as `[Options](ui-elements/#options)` from any article. The generator resolves the relative destination for each page. Link headings with specific meaning; changing heading text need not change the ID. Preserve established public fragments when reorganizing an article. Add new pages to `navigation.json`; Changelog belongs in site navigation, not the list of guide topics.

Keep `activity-filters.json` aligned with the overview table's exact row labels. Review beneficial needs, need costs and harm to feelings explicitly; conditional effects still belong in the row's explanation. The build rejects missing or leftover tags when rows change. Filters select existing rows and do not replace their requirements or model-specific numbers. Without JavaScript, the complete table remains readable.

Supported source syntax is headings, paragraphs, ordinary Markdown links and raster images, ordered and unordered lists, tables, emphasis, code spans and numerical disclosures. Use :::screenshots Desktop and phone screenshots with a closing ::: line to keep paired images beside their instructions without forcing a long gallery open. Raw HTML and executable image formats are rejected. Images must be PNG, JPEG, GIF or WebP with matching file signatures under `docs/player/images/`. Include useful alt text and an adjacent caption. The image opens at full size when selected.

`quick-help.md` is the source for the game's short Help instructions. Vite renders it through the same parser and validates its guide links. The runtime retains the Help dialog's pause, focus, dismissal and shortcut behavior. Keep brief instructions there and longer explanations in the relevant guide article; link them rather than copy long passages.

## Screenshot review

Capture the actual accepted game build in an isolated, muted browser. Record source and output hashes, viewport, access path and state in `screenshots.json`. Include desktop and mobile for every documented UI section. Reuse a screenshot for colocated controls when it shows them clearly; use a close-up and a location image when labels would otherwise be too small. Show the launch control as well as the opened panel. Record unavailable and confirmation states where they change what the player can do.

Explain responsive differences. Desktop needs can appear in the dock; phone needs are in Sim details. Test each path in the real game. Captures are evidence of their displayed state, not proof of unobserved actions. Refresh affected captures when controls, layout, behavior or assets change. Keep recordings and bulk capture sequences out of the repository. Close task-owned game pages and preview servers afterward.

## Validation and publication

Run the guide and changelog tests with `node --test scripts/build-player-guide.test.mjs scripts/player-activity-filters.test.mjs scripts/player-coverage.test.mjs scripts/check-player-reference.test.mjs scripts/build-changelog.test.mjs`. Build the guide with `node scripts/build-player-guide.mjs`. Run `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` for workflow routing changes. Use the normal web type check, relevant web tests and full production build for runtime or presentation changes.

The renderer rejects unknown topics, missing fragments/images, unsafe markup, invalid numerical references and uncovered action or relationship-cause IDs. The reference check rejects changes to reviewed gameplay/UI sources until their guide impact is reviewed. Source fingerprints are review triggers, not proof that a sentence is accurate. A reviewer must still check conditions, direction, timing and no-effect cases.

Before delivery, inspect the actual rendered guide at desktop and phone widths in both themes. Exercise keyboard navigation, section links, search, empty results, disclosures, browser Back and reading without JavaScript. Obtain a fresh novice-player review of the working pages and resolve its findings before claiming completion.

Player Markdown, navigation, effect mappings and images trigger site validation without rebuilding the game. Generated data, review metadata and short Help changes require game checks too. Pages still checks out the tested revision and refuses a stale artifact when newer published content exists. Verify an actual deployment and the public result before calling a change published.
