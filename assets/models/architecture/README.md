# Architecture room candidate

This is the first-room feasibility checkpoint for the approved windows, walls and floors plan. The nine window concepts remain approved. The owner still needs to accept the wall and floor appearance in the actual renderer before the full asset batch starts.

`geometry.py` describes solids in game coordinates. Wall height is 2.0 units, thickness is 0.12, and the baseboard is 0.14 high. Sash, Sliding and Picture retain widths 1, 2 and 3. `clip` physically cuts geometry at height 2/3; it does not hide an upper frame behind a transparent rectangle. Straight segments bevel only edges running along the wall, so neighboring panels meet on their exact authored end planes.

`render_review.py` opens the accepted Sim rig without saving it. Reference meshes and curves move into a render-hidden collection because their visibility drivers can override individual `hide_render` flags. The camera, lighting and toon materials come from that scene. No furniture or Sim source is edited. The camera measures approximately (32,21), (-32,21) and (0,-34.1467436) pixels per source unit. Architecture Z is calibrated by 1.1128440372 so its existing game height remains exactly 38 pixels per world unit; the camera and reference sprites keep their accepted scale.

The exporter emits both axes at full and cut heights for straight walls, corners, doorways, Sash, Sliding and Picture, plus two long review walls and three floor materials. Every color texel has a matching signed R16Float depth value containing local game X + Y. Camera rays intersect the evaluated beveled geometry. Planar cap and side corner normals must agree with their face normal (dot product above .9999). A Weighted Normal modifier is deliberately absent: it blended closed segment ends into otherwise flat caps and repeated a false shade band at each join. Antialiased fringe texels inherit a nearby covered surface owner. The color/depth pair is sampled at the same nearest texel in the renderer. Architecture color does not bake daylight, scenery or floor shadows.

`pack_review.py` checks the completed background receipt and exact output hashes, refuses clipped source images, and crops with registration intact. Floor materials first derive an exact half-open tile footprint, then extend material color into a small opaque texture apron. The vertex shader projects canonical world-grid corners into a physical diamond, so the apron changes no tile dimensions or heights. Adjacent tiles compute identical shared endpoints; the hardware triangle fill rule owns coverage. This avoids both partial-alpha blending seams and holes caused by nearest-texel rounding at integer camera origins. Ordinary architecture keeps paired color/depth texel ownership. Boards have staggered ends, Tiles have thin grout and Carpet has no permanent grid.

Run from the repository root:

```powershell
python -B -m unittest discover -s assets/models/architecture -p 'test_*.py'
Start-Process -FilePath 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' -ArgumentList '--background --threads 2 --python-exit-code 1 --python D:/VIBES/.worktrees/fe58/terrilives/assets/models/architecture/render_review.py -- D:/VIBES/.worktrees/fe58/terrilives/assets/models/architecture/candidate-NEW' -WindowStyle Hidden -PassThru
```

The launcher detaches. Require a fresh `proof.json` with `background: true`, `state: complete`, matching input hashes and all 29 render records. A launcher exit code is not proof of a successful render. Never overwrite a candidate directory. Pack a completed batch into a new review directory:

```powershell
python -B assets/models/architecture/pack_review.py assets/models/architecture/candidate-NEW NEW_REVIEW_DIRECTORY
```

The current trial lives in immutable `docs/assets/review-evidence/architecture/room-01/trial/candidate-08/`. Every packing revision gets a new directory and import identity; replacing files beneath an unchanged Vite JSON import can mix cached metadata with fresh textures. Raw candidate folders stay local; their completed receipt and packed color/depth bytes are tracked. Candidate 01 exposed reference eye geometry through visibility drivers. Candidate 02 fixed isolation but clipped wide/floor source canvases. Candidate 03 fixed framing; GPU review then exposed partial-alpha floor seams and straight-wall endpoint bevels. Candidate 04 corrects wall-end geometry and alpha ownership but still exposes nearest-UV floor holes at integer origins. Packing candidate 05 is rejected because a gutter loop reused shelf-placement variables. Candidate 06 packs the same candidate-04 geometry with validated shelf bounds and a material apron; the renderer owns exact floor coverage. Candidate 07 rejected an overbroad normal check on nearly zero-area bevel slivers. Candidate 08 removes blended corner normals, verifies all planar cap/side normals and retains the original lights. Rejected candidates are not accepted inputs.

The opt-in runtime contract is `ArchitectureAtlas` in `web/src/render/architecture-atlas.ts`. `SpriteRenderer.create(gpu, architecture)` appends a separate trial table after the complete historical table and binds separate color and depth textures. `writeArchitectureDepth` selects mode -2. `writeArchitectureFloor` selects mode -3, retains the historical fixed floor depth and records world tile X/Y separately from the cropped sprite anchor. `setArchitectureCamera(originX, originY)` supplies one shared camera origin; the existing draw scale supplies zoom. Only mode -3 uses these coordinates to generate diamond vertices. Historical zero-depth, wall-plane and furniture-footprint modes remain unchanged. The generated `atlas.ts` and production PNG stay byte-identical. The proof descriptor lives outside the generated manifest so regeneration cannot erase a handwritten interface.

The isolated proof is `web/proofs/architecture-room.js`. Vite permits only its exact trial evidence directory in addition to the default web root. The proof uses the actual `SpriteRenderer`, shader, frame builder and paired occupied-bed rendering. It creates no save, changes no game state and destroys its GPU device in `finally`. Its caller must close the disposable browser context and stop the task-owned server after verification.

```javascript
const { architectureRoomProof } = await import('/proofs/architecture-room.js');
await architectureRoomProof({ scale: 1, show: true, cutaway: true, probes: true });
```

Use scales 1 and 3 for room captures and `cutaway: false` for the full shell. Analytic probes include scale 1.75, source-texel boundary guards, both physical wall faces, top caps and sills. Twenty floor cases check shared endpoints, complete interior coverage, immediate exterior pixels, contrasting materials, missing tiles and reversed draw order. They retain both previously failing scale-1.75 origins and sweep fractional pan/zoom. Samples exactly on mathematical boundaries are excluded from the CPU ownership oracle because the GPU top-left fill rule chooses ownership there; draw-order equality still checks the complete image. Timing reports average 30 submissions plus GPU completion; the historical-art control uses the same candidate renderer and is not a pre-change shader benchmark. These are technical feasibility measurements, not owner appearance acceptance or full production integration.
