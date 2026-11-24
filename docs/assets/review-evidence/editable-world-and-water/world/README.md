# Current geometry and daylight

Captured October 22, 2026 in the displayed desktop browser at 1280 by 720. The game used automatic lighting, muted sound, the default camera and a paused household at Day 1, Monday, 12:23. Both captures came from the same production build and browser session.

1. [Open room](open-room-daylight.jpg): the original north wall segment between the living-room bookcase and sofa was removed through Build controls. Room review and confirmation succeeded. The opening survived Save and Load before this capture. The living room receives daylight through its now-open enclosure.
2. [Closed room](closed-room-daylight.jpg): the same wall segment was rebuilt and confirmed without advancing the game clock. The living room is enclosed and shaded again. The green kitchen tile is an original floor tile removed in a separate confirmed edit; it also survived Save and Load.

The coordinating agent inspected both images. The opening and rebuilt wall occupy the same segment, furniture stays in place, and the living-room lighting changes with enclosure. The browser reported no warnings or errors during this production-build pass. These stills document geometry and daylight; they do not establish animation quality, all supported camera states, or independent visual acceptance.

## Build identity

| Built file | SHA-256 |
| --- | --- |
| `index-N84z5y9I.js` | `c148af76719f3aca60d6f8fe52254e27d0de52e1151bce3d07d468f7f5f3b790` |
| `index-CJ5v8iZB.css` | `af1d76c0bd0761dff991319abdd2369c8b00477ba1234f9fc8a9f73a733244c7` |
| `terri_wasm_bg-BFMghWuH.wasm` | `73ac3cb5747c7e5ae4e9c33736f8e094bc95c5b70c1eccf7f82963a7e6d94b05` |

Type checking and the production build passed before this session. The build reported ineffective dynamic imports for character assets, large JavaScript chunks and asset-plugin timing warnings. The task-owned browser page and preview server were closed afterward.
