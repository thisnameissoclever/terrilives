# Short walls and local fading

Owner-approved presentation change. The two rear exterior walls stay full
height. Interior walls and the two camera-facing exterior walls use one-third
height art with a visible cut edge. Walls and Room tools restore the complete,
opaque shell; Furniture and Buy keep the short walls.

Each short panel records the far-side tiles of its contributing half-segments.
Any visible Sim in those tiles fades that local panel to 25% opacity over 200 ms.
Walking interpolation and occupied-object positions follow the rendered Sim,
not selection or a rounded destination tile. A small exit tolerance prevents
boundary flicker. Multiple Sims keep a panel faded until all have left.
Reduced motion applies the target opacity immediately.

Opaque geometry still writes depth. Short walls draw afterward, back to front,
with depth testing but without depth writes. Sprite coverage is tested before
opacity is applied. Only the bounded wall batch is sorted when geometry changes;
the entity buffer is never sorted. Both layers share the atlas and command submit.

Door leaves and their authored frames remain full-height interactive objects.
Empty passages have short jambs without floating lintels. Interior and camera-facing window panels use authored cut forms in play; rear
exterior windows remain full height with their walls. Full-wall mode restores
each complete frame. The 2026-10-01 geometry includes caps, reveals, baseboards
and mixed-height corner, T and cross junctions. Paired per-pixel depth preserves
ordering through apertures and along beveled surfaces.
Collision, room ownership, lighting propagation, save data and furniture placement
are unchanged. This does not modify or regenerate any existing furniture art.
Frozen legacy cell-layout saves retain their existing presentation contract;
the short-wall view applies to the current explicit-edge architecture. Successful
Load resets transient fading; camera changes preserve it. New Game creates fresh
presentation state with its document reload.

Verification requires local geometry/fade tests, unchanged legacy atlas pixels,
real GPU depth/transparency probes, and a played day/night/build-mode inspection.
An independent read-only reviewer checks the implementation and screenshots before
publication. Passing local checks are not rerun merely to wait for duplicate CI.
