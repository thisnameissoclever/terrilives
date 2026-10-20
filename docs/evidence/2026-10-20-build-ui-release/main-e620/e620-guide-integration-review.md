# E620 guide integration review

**Prose and changelog integration approved. One screenshot-source attribution correction remains pending at this report's initial close.** Reviewed local parent `7a9b6fdb21a010f133e0063a3062ad8c64a06ad9` with incoming main `e620ff5c51acd9779246b8996af8a8f6c1f66c0b`. This is a scoped integration review, not a new audit of the illustration renderer or game implementation.

1. **Conflict prose retains both parents' meaning.** Home controls retain the Furniture illustration immediately before the paragraph that explains footer Confirm/Cancel exit and contextual Cancel. UI elements retain the Household illustration and clipped-activity popup instructions, Furniture and placement illustrations with the footer exit rules, Floors area illustration with rectangle selection and footer exit, room-review illustration with Back/current-tool behavior, and Land illustration with all three batch decisions plus separate Buy land/Buy purchase confirmation. No removed sentence changes a control path or consequence.
2. **Game inputs remain unchanged from the reviewed local parent.** `git diff HEAD -- crates content web/src web/index.html` returned no changed paths. The new guide merge therefore does not itself require rerunning the already accepted native/game suites. Guide generator/parser/CSS/JavaScript and the production artifact still need their own relevant checks and visual acceptance, owned by the parent.
3. **Changelog preserves the published filename and contributions.** There is one October20 source file, `2026-10-20-guide-illustrations.md`, already present on incoming main. It preserves all four upstream Improved bullets and incorporates the five Improved plus one Fixed unpublished Build/status bullets. The title/summary describe both contributions. The removed `2026-10-20-build-controls.md` was this branch's unpublished file. No duplicate delivery-date entry or lost upstream bullet was found.
4. **Semantic screenshot merge preserves the record inventory.** All snapshot IDs from both parents are present: the two branch release snapshots and upstream `guide-controls-refresh-2026-10-20` coexist with the six original snapshots. All87 merged entry IDs preserve the union of both parents. Windows and floor-actions rows equal incoming main; the branch's newer full Walls pair, exit decision, collapsed dock and overview remain. Old provenance is retained rather than rewritten as current evidence.
5. **[P2 metadata] Correct the mixed Walls detail attribution.** The merged `build-walls.desktopDetail` now points at `images/guide/build-walls-desktop.png`, but `imageSourceSnapshots.desktopDetail` still names `minus-fix`, which described the replaced older detail file. The new upstream desktop/mobile detail pair belongs to `guide-controls-refresh-2026-10-20`; add explicit per-image source entries for both while retaining `build-release-main-834` for the branch's full desktop/mobile pair. Initially the old detail hash also remained; a subsequent read showed the parent had corrected hashes, and a fresh scan found every recorded image SHA-256 matched its current file. The source-ID correction was still pending at the last read.
6. **Help replacement must also carry per-image attribution.** Parent is replacing the incoming guide Help crops because their visible footer instructions predate this branch's behavior. Keep the historical full Help captures attributed to their original snapshot, and assign both new detail crops to their actual new capture snapshot with their image hashes. Do not let the mixed row's historical `sourceSnapshot` silently attribute new details to old source. This is already assigned parent work, not an additional request to redesign the guide.

## Hash boundary and validation

The reviewed prose hashes are:

| File | SHA-256 |
| --- | --- |
| docs/player/home-and-controls.md | 8317BEB4AC8F18235AC5B2117D058A22BBE5C34970F5B54ACA5AAF7296A1A68B |
| docs/player/ui-elements.md | 213171D1B35BB33738F0DE942BE2920E2B7C4F4DF4102CD080FB962B473DFAD3 |
| docs/player/changelog/2026-10-20-guide-illustrations.md | 46493696BF8F2C90CC55B6FB7A942D11E23D6A915A07246EFD0531C5C64F58C2 |

Parent reports33 current guide/changelog tests passed in5474.54ms. I did not duplicate those tests, rebuild, inspect new pixels or operate the browser. Existing game checks retain their original accepted boundary. Four-theme rendered-guide/control and no-JavaScript verification, final Help crops, Pages deployment and actual public verification remain parent-owned.

Only this ignored report was written. No product, Git, metadata or image files were edited by this reviewer.

**Next steps**: Parent freezes corrected Walls/Help per-image attribution for a short reread, then completes applicable guide build, visual and delivery checks.
