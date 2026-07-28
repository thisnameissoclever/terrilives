# Asset Provenance

Every third-party asset, its source, and its licence. Kept even where a licence
requires no attribution, because provenance questions are expensive to answer
retroactively and cheap to record now.

**CC0 assets are safe to commit to this public repository. Paid asset-store
content is not** - those licences generally forbid redistributing source, which
is fine inside a compiled build and a violation inside git. See TECH_STACK.md.

## Kenney Furniture Kit

- **Source:** https://kenney.nl/assets/furniture-kit
- **Licence:** CC0 1.0 Universal. Commercial use, modification, and
  redistribution permitted; no attribution required.
- **Downloaded:** 2026-07-28, 4.9 MB
- **Contents:** 140 models in five 3D formats, plus **560 pre-rendered
  isometric PNGs** at four rotations each, plus side-on renders.
- **What we use:** the isometric PNGs only, packed into
  `assets/sprites/atlas.png`. The 3D models are unused for now; [G5] in
  TECH_STACK.md expects characters to need real meshes once customisation
  arrives, and this pack is a candidate then.
- **The source zip is gitignored** (`assets/vendor/`). Only the derived atlas is
  committed, because committing both would put the same art in the repository
  twice. Re-download from the URL above to regenerate.

Sprites in use: `kitchenFridgeBuiltIn`, `bedBunk`, `showerRound`,
`toiletSquare`, `cabinetTelevisionDoors`, `loungeDesignSofaCorner`,
`bathroomSinkSquare`, `bookcaseClosedDoors`.
