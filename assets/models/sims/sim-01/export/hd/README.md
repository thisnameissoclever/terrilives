# Parallel 2x Sim textures

These PNGs contain twice as many pixels per axis as the original exports.
Their manifests retain the original logical dimensions, anchors, hand anchors,
frame names and timing. `pixel_density: 2` changes texture sampling, not world
size. The atlas stores physical pixel rectangles and divides dimensions by
density when drawing, picking, positioning attachments and fitting the camera.

Regenerate from the original 16x review renders, never from native-size PNGs:

```powershell
& C:/Users/myema/AppData/Local/Programs/Python/Python314/python.exe assets/models/sims/sim-01/export_density.py --source-root D:/VIBES/.worktrees/terrilives/rigged-sim-animation/assets/models/sims/sim-01
& C:/Users/myema/AppData/Local/Programs/Python/Python314/python.exe assets/sprites/gen/build.py
```

The exporter writes only this parallel directory. It verifies every recorded
source hash and requires every source to reproduce the hash-validated accepted
native PNG's decoded pixels before writing outputs. This reproduction check is
also the verification for green source frames, which lack individual recorded
source hashes. `proof.json` records all 468 source and output hashes.
Output paths in the proof use relative POSIX syntax so Linux and Windows
resolve the same files. Source provenance paths also use forward slashes.

The saved-rig reading replay discrepancy predates this export and remains
unresolved. Existing rendered PNGs were reused; no rigs were rerendered or edited.
