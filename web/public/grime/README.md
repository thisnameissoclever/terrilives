# Household stain sprites

`household-stains.png` is a transparent 1536 by 1024 sheet with four 768 by 512
cells: coffee spill, mud scuff, dust smear and greasy food smudge. Runtime scale
and depth are defined in `web/src/render/grime-decals.ts`.

Created with the built-in image generation tool on 2026-10-05. The requested
art direction was four isolated decals in a strict two-by-two layout, flat
isometric shapes wider than tall, muted brown and gray, with no floor, objects,
grid, text or cast shadows. Transparency is retained in the shipped PNG.

The renderer uses a stable stain pattern and scales its opacity with actual grime.
New dirt starts at ten percent; cleaning progressively fades it to zero. It does not
recolor the supporting material. Existing floor and furniture artwork remains
separate from these marks.
