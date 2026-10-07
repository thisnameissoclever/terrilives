# Shared sofa source

The source keeps the corrected reader pose from `pose-complete-final-01` and applies the existing neutral sofa sitting pose to the same rig. Three physical seats use the same source body at their authored centers. Each seat can be empty, sitting or reading independently.

The art is static. Each of the four runtime phases explicitly aliases the same source pose. A source frame identifies the occupancy state as `sceneKey * 4`; it never aliases another occupancy state. Shirt palettes use independently rendered visible body contributions, while furniture and shared ink retain the occupied scene's occlusion.

1. In PowerShell, run `python assets/models/reading/sofa/producer/prepare.py OUTPUT (0..26)` with an unused output directory. Pass selected state numbers instead of `(0..26)` for a pilot. This freezes one bounded job per state and facing.
2. Run `assets/models/reading/sofa/producer/launch.ps1 -ManifestPath OUTPUT/STATE-FACING/input-manifest.json` for each prepared job. State folder names use two digits, such as `16-SE`. The launcher retains its writer handle, records the process exit and monitors free memory. Coordinate its writer slot with other rendering work.
3. Run `python assets/models/reading/sofa/producer/export.py OUTPUT EXPORT` after every source writer finishes. The exporter verifies source hashes, registered dimensions, unclipped geometry and additive reconstruction against independent beauty renders. A partial export remains non-importable.

A complete export covers all 27 states in four facings, with three nullable owner positions and every occupied shirt palette combination. Empty-seat palette choices reuse the same scene. The importer requires the complete matrix and retains float-filtered scene alpha from the original beauty source.

The manifest records its static sofa anchor and four-sided padding in logical pixels. Each occupied canvas and owner mask stays registered to that facing's static furniture sprite. Explicit phase aliases must retain identical layers, coverage, markers and owner-source bindings.

Comparisons describe actual uniform green, blue and red beauty renders for each distinct geometry. Mixed shirt palettes compose body layers from those named owner sources; they do not invent an additional beauty comparison. `source-reference-index.json` lists the original beauty files, their hashes, density, canvas, anchor and owner layers for renderer verification. Four phase aliases share each actual source reference.

Successful reconstruction proves that the exported layers reproduce their source images. Visual acceptance of the poses and furniture occupancy is a separate review.
