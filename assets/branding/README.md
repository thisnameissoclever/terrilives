# Natural Causes identity

`approved-logo-pair.png` is the owner-approved source, including the petal
attachment correction accepted on October 18, 2026. Keep this source unchanged.

Run `python scripts/export-branding.py` from the repository root to export the
transparent logos, flower, browser icon, touch icon, and square app-icon PNGs.
The exporter uses the existing Pillow tooling. It removes the dark panel's
background to preserve the pale petal edges, uses that shared shape for both
themes, and applies the approved plum lettering for light backgrounds.

Runtime exports live in `web/public/branding/`. `logo-dark.png` is for dark
backgrounds; `logo-light.png` is for light backgrounds. The root public
`favicon.ico` contains 16, 24, 32, 48, 64, 128, and 256-pixel images.
`apple-touch-icon.png` is 180 pixels square. The 192, 512, and 1024-pixel square
exports can supply installable-app packaging when that build is implemented;
these image files do not add installation or offline support.

The game loading screen, theme-switching changelog header, and repository
README use the logo. Public pages declare relative icon paths so the same
files work beneath the GitHub Pages project directory. Developer proof pages
retain their diagnostic layouts.

Run `node --test scripts/branding.test.mjs` to check project-relative icon links
and exported file formats. The exporter also writes a local review sheet to
`.scratch/branding/exports.png`; review the small icons at their displayed size.
