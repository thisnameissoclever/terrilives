# Compact changelog header review

Review date: 2026-10-18. Base revision: `2a700a66580a2273416ca49e7bdd176c87a1f4b0`.
Scope: `web/changelog/template.html` and `web/changelog/style.css`, with the approved logo files unchanged.

Reviewed source SHA-256 hashes:

1. Template: `fe874161fcbe197fdd0227d9ed35e9ab003a63559ea0018084596146da86012d`.
2. Styles: `cf7c9e18df0e84b7690ba2a4082a97b94a36346cf07a1799c439ca8bea880d53`.

Final result: passed visual review. No actionable P0, P1 or P2 findings remain.
This verdict covers the changelog page, not gameplay or physical-device testing.

## Targets and comparison

The owner approved the compact desktop and phone mockups in this conversation.
The desktop target places the logo, title and grouped controls in one row.
The phone target places the logo beside the controls, then the title beside Expand all.

1. [Desktop comparison](desktop-comparison.png) places the approved mockup on the left and the rendered implementation on the right. Each full content capture is proportionally normalized to 900 pixels wide.
2. [Phone comparison](phone-comparison.png) uses the same ordering, normalized to 390 pixels wide.
3. [Known defective desktop](before-desktop.png) shows the separate navigation band and detached title that caused the reported wasted space.

The desktop mockup is 1624 by 969 pixels; the captured implementation is 1648 by 984.
The phone mockup is 853 by 1844; the captured implementation is 375 by 812.
Browser viewports were 1663 by 993 and 390 by 844 CSS pixels, with device pixel ratio 1.
The browser capture excludes the scrollbar and has different bounds from the CSS viewport.
Comparisons normalize image width rather than claiming exact pixel correspondence.
The generated mockups contain older release text; the implementation retains current notes.

## Inspected captures

1. [Desktop dark](desktop-dark.png): prominent original logo, aligned title, stacked controls and a short path to the first update. The vertical divider separates the logo from the heading.
2. [Desktop light](desktop-light.png): the original plum text logo remains readable; the page retains its existing light colors and borders.
3. [Phone dark](phone-dark.png) and [phone light](phone-light.png): the logo sits beside the controls, the title sits beside Expand all, and the subtitle spans the content width. No overlap appears.
4. [320-pixel viewport](width-320.png): the logo scales proportionally; title and controls remain separate and reachable. The subtitle wraps normally.
5. [768-pixel viewport](width-768.png): the desktop row fits, and Play the game stays on one line after reducing its horizontal padding.

The implementing assistant opened every capture and both combined comparison images.
A fresh independent reviewer first received anonymous desktop candidates. The reviewer rejected
the known defective result for the detached title and wasted space, then accepted the compact result.
After that verdict, the reviewer inspected both themes, narrow phone and tablet captures, the
approved mockups and the source changes. The reviewer reported no actionable P0, P1 or P2 issue.

## Fidelity and intentional differences

1. Fonts: the existing Segoe UI, Helvetica Neue and Arial stack remains. The title retains the existing 44-pixel desktop size and scales down on narrow screens. No external font was introduced. Current release content wraps naturally rather than being shortened to match the mockup.
2. Spacing: the desktop logo, heading and controls share a grid. Updates align with the header's content edges. Expand all follows the divider. The phone layout follows the approved arrangement with less space above the first card.
3. Colors: existing theme variables remain. The generated mockup's vignette is omitted in favor of the established flat page background. Light and dark text, cards and accents retain their existing contrast.
4. Images: both approved transparent logo exports remain unchanged. The mockup's regenerated flower is not substituted for the owner's approved artwork. Captures show no clipping or stretched proportions.
5. Copy: functional labels and subtitle remain literal and unchanged. Current release notes are preserved. The same-day entry adds one sentence describing the compact header.

The differences above preserve the approved composition and current product content.
No separate asset close-up was needed because the logo is unchanged and readable in the full-size captures.

## Measurements and behavior

At the 1663 by 993 desktop viewport, the logo grows from 190 to 252 CSS pixels wide,
an increase of 32.6 percent. The first update moves from 371.66 to 252.38 pixels
below the viewport top, approximately 119 pixels higher. Measure the complete distance
to the updates, not only the header element, because the title moved into that element.

| CSS viewport width | Logo width | First update top | Horizontal overflow |
| --- | --- | --- | --- |
| 320 | 137 | 264.59 | No |
| 375 | 176 | 246.13 | No |
| 480 | 190 | 254.42 | No |
| 760 | 220 | 272.20 | No |
| 768 | 220 | 233.41 | No |
| 1000 | 220 | 233.41 | No |
| 1040 | 252 | 252.38 | No |

Browser checks exercised both themes, a saved theme after reload, Expand all and Collapse all,
keyboard activation of the theme control, its visible three-pixel focus outline, the current
`#update-2026-10-18` link and the older `#2026-10-17-fights` alias. Both links opened the
intended update. The Play link retains its relative `../` destination.

## Validation boundary

The page was generated from its actual Markdown, HTML and CSS and served by a temporary
loopback-only HTTP preview restricted to the changelog and its public logo/icon files.
The other chat's game preview servers were left alone. Browser interaction and visual review
are separate evidence from the automated checks recorded in the pull request.
No game renderer or behavior changed, and this review makes no gameplay acceptance claim.

Physical phones and browsers other than the desktop Chromium browser were not tested.
