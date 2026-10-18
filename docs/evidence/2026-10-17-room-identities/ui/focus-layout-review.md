# R7 focused-field layout review

## Real goal

[G1] Players can edit room names in selection and review while seeing the entire focused control and its outline above reachable footer actions, including short screens, enlarged text, and a reduced visual viewport. Preserve the existing desktop panel, compact dock, literal controls, and dark style.

## Diagnosis check

[D1] The supplied captures establish two historical failure mechanisms. I inspected all four images with `view_image`: `.local-build/r7-landscape-initial.png` hides the name field in a collapsed tool body; `.local-build/r7-parent-landscape-before-focus-followup.png` exposes the field but cuts off its lower outline; `.local-build/r7-landscape-focus-complete.png` shows the upper and lower outline; `.local-build/r7-keyboard-reduced-final.png` cuts off the lower outline. The parent's fresh review measured the last image's cyan top at rows 309-310, sides ending at 357, and no lower horizontal edge. I independently confirm that visual defect, but did not independently count those pixels.

[D2] The alleged current-source third failure is refuted by capture provenance. The reduced-viewport image was written at 06:40:45 UTC; the completed landscape image and bounds receipt were written at 06:48:30 UTC. The parent reports that the scroll-margin correction occurred between those captures. The filename `final` does not establish the source used. A current matched reduced-viewport capture remains necessary; another source change is not justified by this historical image alone.

[D3] Input containment is the wrong acceptance boundary. `web/src/ui/build-controls.css:158` paints a 2px outline at a 2px offset, extending four pixels outside the border box. Compact tool overflow clips at its scrollport (`:86`), independently of whether the input border box fits. Reserving more panel height fixed the collapsed body, but could still position the input bottom flush with the clipping boundary. The current `scroll-margin-block: 6px` (`:159`) directly addresses this omitted paint extent. It is a causal correction, not merely another panel-height guess.

[D4] The current helpers do not establish a complete shared visibility contract. `RoomSelectionControls` registers input, composition, and keyboard handlers but no reveal-on-focus operation (`web/src/ui/room-selection.ts:117-127`). Review creates fields without one too (`web/src/ui/room-review.ts:191-198`). Both share the CSS margin and the viewport-event `scrollIntoView` call in `web/src/main.ts:1771-1785`. That call guards against stealing focus after a change and lets the browser scroll after layout. It runs on viewport changes, not every focus transition. `build-layout.ts:22-35` preserves focus across reparenting with `preventScroll: true`, which preserves the focused identity but does not prove its paint is visible afterward. Native focus behavior supplies the remaining ordinary-focus path; its actual result must be checked.

[D5] There is a separate inline-space concern, not a newly verified pixel failure. Both compact tool and review scrollport reserve 3px padding (`build-controls.css:86,165`), less than the four-pixel outline extent. The landscape receipt `.local-build/r7-landscape-focus-margin-bounds.log` records input left 19 and tool left 16; the ideal outline left is 15. Block-only scroll margin cannot create missing inline space at a scroll-content edge. Inspect the complete left and right edges as well as top and bottom, especially the first review selector. Existing landscape evidence proves visible horizontal outline segments, not every theoretical paint pixel.

[D6] The architecture already separates the compact tool body from its footer. Selection uses a scrolling `.builder-tool` between navigation and batch status/actions (`web/index.html:1446-1456,1506-1509`; CSS `:84-96`). Review uses a heading, scrolling middle, and separate actions (`web/index.html:1494-1504`; CSS `:162-172`). Desktop selection instead has an outer scrolling panel with a sticky footer and an 80px scroll-padding allowance (`CSS:194-203`). These are different clipping owners. Room naming state should not own another layout calculation. The relevant lesson already requires measuring the input plus outline after viewport and reparenting changes (`docs/lessons-learned.md:12358-12363`).

## What was taken as fixed but is not

[F1] A larger dock does not guarantee a visible outline. The invariant is that the focused painted rectangle fits inside the intersection of its scrolling/clipping ancestors and visible viewport, with enough real scroll range to reach that position. A 64px tool minimum (`CSS:185`) can fit an ordinary 44px input plus its ring, but does not define an enlarged-text guarantee.

[F2] Existing three-pixel padding is negotiable. Reserve the actual four-pixel focus extent, with explicit clearance if desired. Keep scroll-content padding and scroll-target margin distinct: margin influences alignment; padding provides real space at content edges.

[F3] The latest screenshot label and the apparent sequence of fixes are negotiable evidence assumptions. Pin source or built-file hashes and capture time before deciding a repair failed. Testing Protocol section 9 explicitly requires that provenance (`docs/testing-protocol.md:229-234`).

## Alternative routes

[ALT1] Complete the existing declarative focus-space contract.

Mechanism: retain native scrolling and the current six-pixel target margin. Use one shared focus-clearance value for the room scroll bodies and targets, ensuring real padding contains the four-pixel outer outline on every edge. Preserve the existing viewport callback. First capture current source without edits; alter only an edge whose contract is demonstrably insufficient.

Work required: current matched evidence first; if inline clipping is confirmed, make a bounded room-only CSS adjustment to tool/review padding and related negative margins. Check the actual resulting body height at enlarged text. Keep state controllers unchanged.

Costs and risks: a few pixels less content width/height; padding and negative margins need joint review. Native focus scrolling still requires browser verification.

Makes easier or harder later: one visible-space rule remains inspectable in CSS; focus geometry changes must update its reserved space.

[ALT2] Give both room surfaces one explicit focus-reveal operation.

Mechanism: a shared DOM helper runs on delegated focus entry, viewport change, and completed reparenting. It uses the existing browser scrolling API with the declared focus clearance and the actual owning scrollport. It does not compute panel placement or introduce a second layout engine.

Work required: centralize event ownership and call the helper from the existing viewport and layout lifecycle. Keep the focus-equality guard and reserve physical edge space in CSS. Verify selection and review with identical interaction cases.

Costs and risks: more lifecycle code; an overbroad handler could disturb deliberate scrolling or scroll outer ancestors. Do not add retries, polling, or arbitrary delays. Use this only if matched evidence shows native focus entry or reparenting leaves the field clipped despite sufficient space.

Makes easier or harder later: explicit lifecycle coverage is easier to exercise; more events and ownership rules need maintenance.

[ALT3] Normalize the room panel into a header, scrolling body, and footer at every size.

Mechanism: give desktop selection the same structural scroll ownership already used by review and compact mode. Footer size participates in layout instead of relying on the desktop 80px allowance. Keep the 304px width and existing compact-layout owner.

Work required: change the room shell's layout and isolate the desktop rule from other Build tools; retest navigation, footer reachability, review transition, and reparenting.

Costs and risks: wider regression scope than the current defect warrants. It cannot by itself repair insufficient outline padding.

Makes easier or harder later: fewer scroll ownership differences and no room-footer height guess; more care around shared Build shell rules now.

## Recommendation

[R1] Take [ALT1], the existing declarative focus-space contract, beginning with current-source matched captures. The latest six-pixel scroll margin fixes the omitted vertical paint extent, and the supposed subsequent failure is an older capture. Do not start another height or timing patch on that evidence. If current pixels show clipped inline edges, reserve the full outline extent in both room scroll bodies as the smallest structural correction. Take [ALT2], the explicit shared focus-reveal operation, only if ordinary focus or reparenting still fails with adequate space. [ALT3], the normalized panel shell, has unnecessary scope unless the desktop sticky-footer budget demonstrably fails.

## What I could not determine

[U1] Current-source reduced-viewport and review pixels were not supplied. I ran no browser, test, or build, as instructed. This review does not approve current visual acceptance or establish physical mobile behavior.

[U2] Bound the follow-up to selection and review on desktop, phone portrait, 740x390, enlarged text, and 390x480 reduced viewport. Exercise keyboard focus, pointer focus, a viewport reduction while already focused, and review return. Record the active element, field rect, scrollport client clipping box, scroll range, footer rect, viewport metrics, and source/build hash. Inspect full-ring pixels independently of those rectangles. Require the historical defective image to fail the same visual criterion. For a causal control, remove only the focus margin in an isolated browser, require the matched outline assertion to fail, restore it, and verify recovery. Do not fabricate DOM rectangles or add a production test hook.

**Next steps**: The parent and source owner should complete the current matched captures before deciding whether another change is needed. No user action is required for this review handoff.
