# Player guide implementation plan

**Goal:** Deliver the approved issue #313 guide with complete activity and relationship references, desktop/mobile UI screenshots, useful subsection links, weather coverage, and automatic static-site generation.

**Architecture:** Player Markdown, navigation and effect mappings live in `docs/player/`. The current changelog sources move under that directory while their public addresses remain stable. A dependency-free Node renderer emits static guide pages using the existing changelog design; a Rust exporter supplies derived gameplay data. Vite serves the same output in development and production.

**Specification:** [Approved proposal](../../proposals/issue-313/README.md). The final owner correction removes Changelog from the guide's topic navigation. Keep site-level navigation distinct from guide topics. Apply writing-style-tim, Unslop and the Natural Causes writing skill throughout.

## Ownership and implementation

1. Author the guide chapters and complete effect coverage from current source. Markdown supports headings with explicit `{#anchor}` IDs, paragraphs, ordinary Markdown links/images, lists, tables, and `:::numbers Title` disclosures. Use page links such as `ui-elements/#options` from the guide root; the renderer resolves them correctly from every page. Page slugs: start-here, ui-elements, needs, activities, relationships, mood-and-personality, home-and-controls, the-world, glossary. Review data and engineering pointers stay outside public prose.
2. Export current compiled actions, needs, modifiers and contextual values without changing gameplay or dependencies. Commit generated JSON and a source review map. Verify exporter output against the snapshot and reject edits that only tamper with generated values. Cover each action and relationship cause in the article mapping.
3. Capture real desktop and mobile controls in an isolated muted local game session. Use a manifest tying every UI subsection to images and exact actions. Capture both entry controls and expanded panels; state responsive differences explicitly. Include actual leaves and snow.
4. Build and test the static renderer, navigation, search, disclosures, section links and no-script index. Use the changelog's branding, styles and theme behavior. Generate the short in-game Help from one authored document and add the guide link. Migrate all changelog consumers together, including classifier, tests and contributor guidance.
5. Validate generation, links, snapshots, coverage, classification, web types/tests/build and source changes. Inspect actual pages at desktop/mobile sizes and both themes. Obtain a fresh novice-player review of the working guide, correct findings, and retain dated evidence. Show the completed local guide to the owner after review; publication remains a separate delivery action if not already authorized.

## Required checks

Missing page/fragment/image, duplicate anchors, unsafe markup, unknown numeric reference, unclassified action/cause, changed reviewed gameplay source, tampered snapshot, and docs-only publication routing must have meaningful rejection tests. Do not classify unrelated engineering Markdown as public content. Preserve old changelog links and exact-tested-revision Pages behavior.

## Current-source ruling

Refresh the checkout before writing. Main advanced during planning to the Social/household-balance change; correspondence now provides Social while alone, and family modifies relationship events. Use current source rather than copying the superseded proposal's balance examples. Preserve the existing approved roadmap additions when refreshing main.
