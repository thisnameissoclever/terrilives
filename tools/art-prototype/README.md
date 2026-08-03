# Art prototype

**Not wired into anything.** Nothing in the game imports this, CI does not
run it, and it writes no file the build reads. It is here because it is the
evidence the Muted Line decision was made against, and losing it would mean
losing the only executable statement of what that direction actually is.

The plan for turning it into the real sprite generator is
`docs/specs/2026-08-03-muted-line-implementation.md`, [ML-gen].

## What it is

A from-scratch isometric sprite renderer. There is no Kenney asset, no
purchased pack and no third-party image anywhere in it: every pixel is
drawn from primitives.

The bet it tests is that at a locked isometric camera and roughly 80 px per
object, furniture is shaded boxes. If that holds, an art direction is a
**shape language, a palette and a character build**, all three of which are
data, and one object vocabulary can serve any number of directions.

It holds.

## The files

| File | What |
|---|---|
| `art.py` | The primitives, the object vocabulary, the parametric character, and round one's five directions |
| `art2.py` | Round two's five directions, plus the lighting rig - ambient tint, key direction, cast shadows, floor-clipped light pools |
| `cycle.py` | One palette at four hours, which is what showed that night is a lighting setting rather than a second art style |

Muted Line is the `muted` entry in `art2.py`.

## Running it

```sh
pip install Pillow
python3 art.py      # writes ten PNGs beside itself
python3 art2.py
python3 cycle.py
```

Output paths are absolute and point at a scratch directory that no longer
exists. Change `OUT` at the top of each file before running. That is one of
several things the port fixes; this is a prototype and reads like one.

## Two findings worth keeping

**The projection is load-bearing and is not 2:1.** These files use
`TILE_HALF_WIDTH 32` and `TILE_HALF_HEIGHT 21`, imported by hand from
`web/src/render/iso.ts`. The real generator must share that constant rather
than copy it, because a sprite drawn at a different ground slope than the
grid it stands on is the bug that made wall runs look jagged before.

**Walls belong on tile edges, drawn per run.** The shipped renderer puts a
half-tile-wide panel at a tile centre and emits one instance per tile, so
the panel's lit edge repeats every 32 px and a run stripes into a picket
fence. `o_wall` here takes a length and draws the whole run as one box.
That is [B7], and it is the largest single visual difference between these
renders and the game.
