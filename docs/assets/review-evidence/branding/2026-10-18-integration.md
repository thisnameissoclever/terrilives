# Branding integration verification

Verified on October 18, 2026, against base revision
`861fae2ebd46d1211ef30559374e2ca5976a0742` with the branding changes applied.
The approved image has SHA-256
`54cc327c878df987acb140b1ade51338dbead585cb3824a3f8da4a925bdba651`.

The game loading screen, changelog header, and README use the approved logo.
Game, changelog, and public audio-review pages declare the icon and touch icon.
The exporter retains the approved flower shape, removes the review background,
and supplies transparent theme variants plus app-icon PNGs.

## Browser evidence

The changelog was inspected at 1280 by 900 and 375 by 812 CSS pixels in both
themes. The correct logo appeared after theme changes, all image requests
loaded, and neither viewport had horizontal overflow. Captures:

1. [Dark desktop](changelog-dark-desktop.png).
2. [Light desktop](changelog-light-desktop.png).
3. [Dark phone width](changelog-dark-phone.png).
4. [Light phone width](changelog-light-phone.png).

The [desktop loading screen](game-loading-desktop.png) and
[phone-width loading screen](game-loading-phone.png) showed the complete logo,
spinner, and progress text. Startup completed with WebGPU available. Closing
Help resumed the household; the [running phone-width capture](game-running-phone.png)
showed Tim walking. These are desktop-browser viewport checks, not physical
phone measurements.

The production build was served under `/terrilives/`. The game and changelog
resolved their logo and icon paths within that prefix. The favicon returned
HTTP 200 with `image/x-icon`; the touch icon returned HTTP 200 with `image/png`.
Both transparent logo files loaded at their expected dimensions. Task-owned
browser pages and preview servers were closed after verification.

## Independent review

The reviewer inspected the approved artwork, exported logos and flower, both
changelog themes and widths, loading screens, and the actual 16- and 32-pixel
ICO frames. An initial icon-scale finding was corrected by explicitly
enlarging the artwork to its intended bounds before resizing the square export.
The [final export sheet](exported-logos-and-icons.png) retains the bent stem and
pale flower at small sizes. Individual petal detail is necessarily absent at
16 pixels. The final review reported no blocking findings.

## Automated checks

1. Branding and changelog tests: 17 passed. The three missing icon-declaration
   tests failed before the page changes and passed afterward.
2. Startup-loading and skill-mirror tests: 17 passed.
3. Workflow contract tests: 24 passed.
4. Web typecheck, release WebAssembly compilation, and production build passed.
5. Documentation identifiers and whitespace checks passed.
6. The full web suite completed with 3,731 passing tests and one generated-page
   mismatch. The public audio-review publisher was updated to emit the same
   icon links as its checked-in output. Its 16-test focused audio-review rerun
   passed, as did the branding and changelog checks. The other passing web
   tests were not repeated after this isolated publisher correction.

The square app-icon exports are packaging inputs. No native shell, installation
flow, or offline support is introduced by this change. Publication is separate
from the local verification described here.
