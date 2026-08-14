#!/usr/bin/env python3
"""Build the sprite atlas and its two manifests.

Replaces build-atlas.ps1, which was Windows-only System.Drawing and which
CI therefore never ran, so the committed atlas was a blob nobody could
verify. This is Python and Pillow, so it runs on Linux, in CI, and under
an agent, and `--check` makes the atlas a reproducible build output rather
than a trusted artifact. See [ML-gen] and [ML-ci] in
docs/specs/2026-08-03-muted-line-implementation.md.

Two manifests rather than one, unchanged from the script this replaces:
Rust reads TOML already and the web build has no TOML parser. Both are
written in the same pass from the same in-memory list, so they cannot
disagree unless one is hand-edited, and web/tests/atlas.test.ts reads the
TOML and fails if they do.

    python3 assets/sprites/gen/build.py            # write
    python3 assets/sprites/gen/build.py --check    # fail if it would differ
"""
import argparse
import hashlib
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageChops                              # noqa: E402

import objects                                                  # noqa: E402
from iso import canvas, emit                                    # noqa: E402
from style import TILE_HALF_WIDTH, TILE_HALF_HEIGHT             # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# The PNG lives under the Vite root, in `web/public/`, so the dev server,
# `preview`, and the production build all serve it from the app's own origin
# at a plain relative URL.
#
# It used to sit beside the manifest in `assets/` and be pulled in by a
# TypeScript `import` from outside the root. Vite serves that through
# `/@fs/<absolute path>`, which is dev-server-only, embeds the developer's
# filesystem layout in a URL, and needs `server.fs.allow` opened up. On a
# Windows checkout the URL becomes `/@fs/D:/...`, and when anything goes
# wrong with it the game dies on `TypeError: Failed to fetch` with no clue
# which of the several moving parts failed.
#
# The manifest stays in `assets/` because terri-data's build script reads
# it; nothing in Rust ever reads the image.
ATLAS_PNG = os.path.join(ROOT, "web", "public", "atlas.png")
ATLAS_TOML = os.path.join(ROOT, "assets", "sprites", "atlas.toml")
ATLAS_TS = os.path.join(ROOT, "web", "src", "render", "atlas.ts")


def revisioned_atlas_name(png_sha256):
    """The immutable public pathname paired with one exact PNG payload."""
    return f"atlas-{png_sha256}.png"


def revisioned_atlas_paths():
    """Only generator-owned hashed atlas siblings, never arbitrary PNGs."""
    public = os.path.dirname(ATLAS_PNG)
    pattern = re.compile(r"^atlas-[0-9a-f]{64}\.png$")
    try:
        names = os.listdir(public)
    except FileNotFoundError:
        return []
    return [os.path.join(public, name) for name in names if pattern.fullmatch(name)]


PADDING = 1          # a transparent gutter, so no sprite samples its neighbour

LEGACY_PREFIX_SHA256 = (
    "6465016ab5c5000dd166aa6441edaf051e8410c5af75799fbe56eec686c12751"
)
# Re-baselined for the Clear Line atlas pass: furniture ink/faces, character
# proportions, and opaque contact stains. Names 0 through 146 are unchanged
# (`LEGACY_PREFIX_SHA256`); `carried_dinner` pixels are unchanged
# (`DINNER_PIXELS_SHA256`). Chat frames stay put; the 0–171 complement moves
# because the furniture on those indices was redrawn in place.
CHAT_PIXELS_SHA256 = (
    "8daee23b4021517d1fae866f1cd89ef633e2d8bcedd3cdc16eb524713d6b56bd"
)
DINNER_PIXELS_SHA256 = (
    "1ac2f0505b58157e42d72de325100e20f5742a1b24c5dfa43592ec58d9ebd4dd"
)
# The decoded-record baseline for indices 0 through 171, excluding only the
# bike and aquarium replacements at 24 and 32. Atlas coordinates are packing
# output and deliberately absent; identity, dimensions, and pixels are pinned.
AQUARIUM_BIKE_COMPLEMENT_SHA256 = (
    "1b00df2c7761f9460b858f7c8eddcaaef1e0dc4a5522c081e4990c8e91a6da77"
)


def seated_reading_names():
    return [
        f"{look}Read{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def standing_reading_names():
    return [
        f"{look}StandRead{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def walking_names():
    return [
        f"{look}Walk{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def exercise_names():
    return [
        f"{look}Exercise{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def watch_fish_names():
    return [
        f"{look}WatchFish{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def named_pixel_digest(sprites):
    digest = hashlib.sha256()
    for name, image, _, _ in sprites:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(image.tobytes())
    return digest.hexdigest()


def sprite_record_digest(sprites):
    """Hash decoded pixels with the identity and dimensions that frame them."""
    digest = hashlib.sha256()
    for name, image, width, height in sprites:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(width.to_bytes(4, "big"))
        digest.update(height.to_bytes(4, "big"))
        digest.update(image.tobytes())
    return digest.hexdigest()


def alpha_difference(left, right, box):
    a = left.getchannel("A").crop(box).tobytes()
    b = right.getchannel("A").crop(box).tobytes()
    return sum(pa != pb for pa, pb in zip(a, b))


def maximum_narrow_skin_run(image, skin):
    """Count narrow exposed-skin rows between the head and shoulders."""
    pixels = image.load()
    longest = current = 0
    for y in range(18, 45):
        skin_pixels = sum(
            1
            for x in range(image.width)
            if pixels[x, y][3] > 0 and pixels[x, y][:3] == skin
        )
        if 0 < skin_pixels <= 8:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def validate_reading_contract(sprites):
    """Fail generation if the append-only reading art becomes a hollow list.

    The committed PNG is the pixel golden checked by --check. These assertions
    make the intended range, fixed envelope, and actual two-frame motion fail
    before either manifest can be written.
    """
    names = [name for name, _, _, _ in sprites]
    seated = seated_reading_names()
    standing = standing_reading_names()
    if names[98:122] != seated:
        raise SystemExit("reading body sprites must occupy indices 98 through 121")
    if names[122] != "indicatorReading":
        raise SystemExit("indicatorReading must remain at index 122")
    if names[123:147] != standing:
        raise SystemExit("standing-read body sprites must occupy indices 123 through 146")

    by_name = {name: (image, width, height) for name, image, width, height in sprites}
    for name in seated + standing:
        image, width, height = by_name[name]
        if (width, height) != (38, 88):
            raise SystemExit(f"{name}: reading body must be exactly 38x88")
        if image.getchannel("A").getbbox() is None:
            raise SystemExit(f"{name}: reading body has no visible pixels")

    for stem in ("Read", "StandRead"):
        for look in ("sim", "sim2", "sim3"):
            for facing in ("SE", "NW", "SW", "NE"):
                quiet = by_name[f"{look}{stem}{facing}0"][0]
                active = by_name[f"{look}{stem}{facing}1"][0]
                if quiet.tobytes() == active.tobytes():
                    raise SystemExit(
                        f"{look}{stem}{facing}: the two frames are pixel-identical"
                    )

        for frame in (0, 1):
            for look in ("sim", "sim2", "sim3"):
                facings = {
                    by_name[f"{look}{stem}{facing}{frame}"][0].tobytes()
                    for facing in ("SE", "NW", "SW", "NE")
                }
                if len(facings) != 4:
                    raise SystemExit(
                        f"{look}{stem} frame {frame}: two facings are pixel-identical"
                    )
            for facing in ("SE", "NW", "SW", "NE"):
                looks = {
                    by_name[f"{look}{stem}{facing}{frame}"][0].tobytes()
                    for look in ("sim", "sim2", "sim3")
                }
                if len(looks) != 3:
                    raise SystemExit(
                        f"{stem}{facing}{frame}: two Sim looks are pixel-identical"
                    )

    for look in ("sim", "sim2", "sim3"):
        for facing in ("SE", "NW", "SW", "NE"):
            seated_frame = by_name[f"{look}Read{facing}0"][0]
            standing_frame = by_name[f"{look}StandRead{facing}0"][0]
            if seated_frame.tobytes() == standing_frame.tobytes():
                raise SystemExit(
                    f"{look} {facing}: seated and standing reading are pixel-identical"
                )

    for look, palette in zip(
        ("sim", "sim2", "sim3"), objects.CHARACTER_PALETTES
    ):
        for facing in ("SE", "NW", "SW", "NE"):
            for frame in (0, 1):
                name = f"{look}Read{facing}{frame}"
                exposed = maximum_narrow_skin_run(by_name[name][0], palette["skin"])
                if exposed > 4:
                    raise SystemExit(
                        f"{name}: exposes {exposed} narrow neck rows; maximum is 4"
                    )


def validate_animation_repair_contract(sprites):
    """Pin old art and prove the appended walk and snack assets are real."""
    names = [name for name, _, _, _ in sprites]
    legacy_digest = hashlib.sha256(
        "\0".join(names[:147]).encode("utf-8")
    ).hexdigest()
    if legacy_digest != LEGACY_PREFIX_SHA256:
        raise SystemExit(
            "sprite names or order changed inside the fixed 0 through 146 prefix"
        )

    walk = walking_names()
    if len(names) < 172 or names[147:171] != walk or names[171] != "heldSnack":
        raise SystemExit("walk must occupy 147 through 170 and heldSnack must remain 171")

    # Only the two repurposed inert-object records may change in the shipped
    # 0 through 171 range. Everything new appends after the fixed prefix.
    protected_existing = [
        sprite for index, sprite in enumerate(sprites[:172])
        if index not in (24, 32)
    ]
    if sprite_record_digest(protected_existing) != AQUARIUM_BIKE_COMPLEMENT_SHA256:
        raise SystemExit(
            "decoded pixels changed outside the two intentional object replacements"
        )

    if named_pixel_digest(sprites[50:74]) != CHAT_PIXELS_SHA256:
        raise SystemExit("accepted conversation pixels changed during animation repair")

    by_name = {
        name: (image, width, height)
        for name, image, width, height in sprites
    }
    dinner = by_name["carried_dinner"]
    if hashlib.sha256(dinner[0].tobytes()).hexdigest() != DINNER_PIXELS_SHA256:
        raise SystemExit("carried_dinner pixels changed during animation repair")

    for name in walk:
        image, width, height = by_name[name]
        if (width, height) != (38, 88):
            raise SystemExit(f"{name}: walk body must be exactly 38x88")
        if image.getchannel("A").getbbox() is None:
            raise SystemExit(f"{name}: walk body has no visible pixels")
        if image.getchannel("A").getbbox()[3] != 88:
            raise SystemExit(f"{name}: walk body lost its bottom-centred contact row")

    for look in ("sim", "sim2", "sim3"):
        for facing in ("SE", "NW", "SW", "NE"):
            quiet = by_name[f"{look}Walk{facing}0"][0]
            active = by_name[f"{look}Walk{facing}1"][0]
            if alpha_difference(quiet, active, (0, 54, 38, 88)) < 24:
                raise SystemExit(
                    f"{look}Walk{facing}: lower-body silhouettes barely change"
                )
            if alpha_difference(quiet, active, (0, 32, 38, 60)) < 16:
                raise SystemExit(
                    f"{look}Walk{facing}: arm silhouettes barely change"
                )

        for frame in (0, 1):
            silhouettes = {
                by_name[f"{look}Walk{facing}{frame}"][0]
                .getchannel("A")
                .tobytes()
                for facing in ("SE", "NW", "SW", "NE")
            }
            if len(silhouettes) != 4:
                raise SystemExit(
                    f"{look} walk frame {frame}: two directional silhouettes match"
                )

    snack = by_name["heldSnack"]
    if (snack[1], snack[2]) != (14, 10):
        raise SystemExit("heldSnack must be exactly 14x10")
    snack_pixels = snack[0].load()
    visible = [
        snack_pixels[x, y]
        for y in range(snack[2])
        for x in range(snack[1])
        if snack_pixels[x, y][3] > 0
    ]
    if not visible or len({pixel[:3] for pixel in visible}) < 3:
        raise SystemExit("heldSnack must be nonempty and visibly multicoloured")
    prop_width = max(snack[1], dinner[1])
    prop_height = max(snack[2], dinner[2])
    snack_normalized = Image.new("RGBA", (prop_width, prop_height), (0, 0, 0, 0))
    dinner_normalized = Image.new("RGBA", (prop_width, prop_height), (0, 0, 0, 0))
    snack_normalized.alpha_composite(
        snack[0], ((prop_width - snack[1]) // 2, prop_height - snack[2])
    )
    dinner_normalized.alpha_composite(
        dinner[0], ((prop_width - dinner[1]) // 2, prop_height - dinner[2])
    )
    if snack_normalized.tobytes() == dinner_normalized.tobytes():
        raise SystemExit("heldSnack and carried_dinner must be distinct props")


def validate_aquarium_bike_contract(sprites):
    """Pin the replacement records and every append-only art contract."""
    names = [name for name, _, _, _ in sprites]
    exercise = exercise_names()
    watch = watch_fish_names()
    expected_suffix = [
        "aquariumCabinet1",
        "indicatorExercise",
        "indicatorWatchFish",
        *exercise,
        *watch,
    ]
    if len(names) < 223 or names[172:223] != expected_suffix:
        raise SystemExit(
            "aquarium, indicators, exercise, and watch art must occupy 172 through 222"
        )
    if names[24] != "cardboardBoxOpen" or names[32] != "bookcaseClosedWide":
        raise SystemExit("bike and aquarium frame zero must retain indices 24 and 32")

    by_name = {
        name: (image, width, height)
        for name, image, width, height in sprites
    }
    bike = by_name["cardboardBoxOpen"]
    aquarium_zero = by_name["bookcaseClosedWide"]
    aquarium_one = by_name["aquariumCabinet1"]
    if (bike[1], bike[2]) != (80, 88):
        raise SystemExit("cardboardBoxOpen exercise bike must be exactly 80x88")
    if (aquarium_zero[1], aquarium_zero[2]) != (80, 104):
        raise SystemExit("bookcaseClosedWide aquarium must be exactly 80x104")
    if (aquarium_one[1], aquarium_one[2]) != (80, 104):
        raise SystemExit("aquariumCabinet1 must share frame zero's 80x104 envelope")
    if bike[0].getchannel("A").getbbox() is None:
        raise SystemExit("exercise bike has no visible pixels")
    if aquarium_zero[0].getchannel("A").getbbox() is None:
        raise SystemExit("aquarium frame zero has no visible pixels")
    if bike[0].getchannel("A").getbbox() != (8, 34, 56, 88):
        raise SystemExit("exercise bike lost its planted, east-wall-safe envelope")
    if aquarium_zero[0].getchannel("A").getbbox() != (26, 15, 80, 104):
        raise SystemExit("aquarium lost its planted, west-wall-safe envelope")
    if (
        aquarium_zero[0].getchannel("A").getbbox()
        != aquarium_one[0].getchannel("A").getbbox()
    ):
        raise SystemExit("aquarium fish motion changed the object's alpha envelope")

    difference = ImageChops.difference(aquarium_zero[0], aquarium_one[0])
    # RGBA getbbox defaults to alpha-only in Pillow. Both aquarium frames are
    # fully opaque through the tank, so that default can miss an RGB-only
    # water, lid, or cabinet mutation. Always inspect all four channels.
    difference_box = difference.getbbox(alpha_only=False)
    if difference_box is None:
        raise SystemExit("aquarium frames are pixel-identical")
    fish_motion_regions = (
        (26, 49, 42, 57),
        (50, 51, 65, 57),
        (57, 61, 70, 68),
    )
    changed_by_region = [0] * len(fish_motion_regions)
    for y in range(aquarium_zero[2]):
        for x in range(aquarium_zero[1]):
            if aquarium_zero[0].getpixel((x, y)) == aquarium_one[0].getpixel((x, y)):
                continue
            matching_regions = [
                index
                for index, (left, top, right, bottom) in enumerate(fish_motion_regions)
                if left <= x < right and top <= y < bottom
            ]
            if not matching_regions:
                raise SystemExit(
                    "aquarium animation changed a pixel outside the reviewed "
                    f"fish-motion mask at ({x}, {y})"
                )
            for index in matching_regions:
                changed_by_region[index] += 1
    if any(count == 0 for count in changed_by_region):
        raise SystemExit(
            "aquarium animation lost motion from one of the three reviewed fish regions"
        )

    for indicator in ("indicatorExercise", "indicatorWatchFish"):
        image, width, height = by_name[indicator]
        if (width, height) != (26, 26) or image.getchannel("A").getbbox() is None:
            raise SystemExit(f"{indicator} must be a visible 26x26 bubble")
    if (
        by_name["indicatorExercise"][0].tobytes()
        == by_name["indicatorWatchFish"][0].tobytes()
    ):
        raise SystemExit("exercise and watching-fish indicators must be distinct")

    for stem, action_names, motion_box, minimum in (
        ("Exercise", exercise, (0, 50, 38, 88), 24),
        ("WatchFish", watch, (0, 0, 38, 88), 12),
    ):
        for name in action_names:
            image, width, height = by_name[name]
            if (width, height) != (38, 88):
                raise SystemExit(f"{name}: action body must be exactly 38x88")
            if image.getchannel("A").getbbox() is None:
                raise SystemExit(f"{name}: action body has no visible pixels")

        for look in ("sim", "sim2", "sim3"):
            for facing in ("SE", "NW", "SW", "NE"):
                quiet = by_name[f"{look}{stem}{facing}0"][0]
                active = by_name[f"{look}{stem}{facing}1"][0]
                if alpha_difference(quiet, active, motion_box) < minimum:
                    raise SystemExit(
                        f"{look}{stem}{facing}: the two silhouettes barely move"
                    )
            for frame in (0, 1):
                facings = {
                    by_name[f"{look}{stem}{facing}{frame}"][0].tobytes()
                    for facing in ("SE", "NW", "SW", "NE")
                }
                if len(facings) != 4:
                    raise SystemExit(
                        f"{look}{stem} frame {frame}: two facings are pixel-identical"
                    )

        for facing in ("SE", "NW", "SW", "NE"):
            for frame in (0, 1):
                looks = {
                    by_name[f"{look}{stem}{facing}{frame}"][0].tobytes()
                    for look in ("sim", "sim2", "sim3")
                }
                if len(looks) != 3:
                    raise SystemExit(
                        f"{stem}{facing}{frame}: two Sim looks are pixel-identical"
                    )


def render_all():
    out = []
    for fn in objects.SPRITES:
        img, d = canvas()
        fn(d)
        ew, eh = objects.EXACT.get(fn.__name__, (None, None))
        try:
            crop, w, h = emit(img, ew, eh)
        except ValueError as err:
            raise SystemExit(f"{fn.__name__}: {err}") from err
        out.append((fn.__name__, crop, w, h))
    validate_reading_contract(out)
    validate_animation_repair_contract(out)
    validate_aquarium_bike_contract(out)
    return out


def pack(sprites, width=512):
    """Shelf packing, tallest first. The sheet is small and static, so the
    simplest algorithm that does not waste half the texture is the right
    one - there is no runtime cost to a slightly loose pack."""
    order = sorted(range(len(sprites)), key=lambda i: -sprites[i][3])
    x = y = shelf = 0
    placed = {}
    for i in order:
        _, _, w, h = sprites[i]
        if x + w + PADDING > width:
            x, y, shelf = 0, y + shelf + PADDING, 0
        placed[i] = (x, y)
        x += w + PADDING
        shelf = max(shelf, h)
    height = y + shelf + PADDING
    return placed, width, height


def compose(sprites, placed, width, height):
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for i, (_, crop, w, h) in enumerate(sprites):
        sheet.paste(crop, placed[i], crop)
    return sheet


def write_toml(sprites, placed, width, height):
    lines = [
        "# GENERATED by assets/sprites/gen/build.py. Do not edit by hand.",
        "#",
        "# The atlas manifest terri-data validates every object's `sprite`",
        "# field against, and resolves to the index the render buffer",
        "# carries. That index is the position of the [[sprite]] block",
        "# below, counting from 0, so reordering this file renumbers every",
        "# sprite after the change.",
        "#",
        "# x, y, w and h are texels in atlas.png. w and h are also the",
        "# sprite's size on screen: the quad is drawn one texel to one",
        "# pixel.",
        "",
        'image = "atlas.png"',
        f"width = {width}",
        f"height = {height}",
    ]
    for i, (name, _, w, h) in enumerate(sprites):
        px, py = placed[i]
        lines += ["", "[[sprite]]", f'name = "{name}"',
                  f"x = {px}", f"y = {py}", f"w = {w}", f"h = {h}"]
    return "\n".join(lines) + "\n"


def write_ts(sprites, placed, width, height, png_sha256):
    rows = []
    for i, (name, _, w, h) in enumerate(sprites):
        px, py = placed[i]
        rows.append(f"  {{ name: '{name}', x: {px}, y: {py}, w: {w}, h: {h} }},")
    body = "\n".join(rows)
    # The export NAMES here are load-bearing: sprites.ts imports `SPRITES`,
    # `ATLAS_WIDTH` and `ATLAS_HEIGHT` by those names. Renaming any of them
    # is a compile error at best and a silently empty atlas at worst.
    return f"""// GENERATED by assets/sprites/gen/build.py. Do not edit by hand.
//
// The renderer's half of the atlas manifest. The other half is
// assets/sprites/atlas.toml, which terri-data validates content
// against; `atlas.test.ts` reads that file and fails if the two drift.
//
// A sprite's INDEX is its position in `SPRITES`, and that index is what
// the render buffer carries for every entity. It has to agree with the
// order of the [[sprite]] blocks in the TOML, which is why both files
// are written in one pass rather than maintained separately.

/** One packed sprite. `w` and `h` are texels and screen pixels alike. */
export interface AtlasSprite {{
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}}

export const ATLAS_WIDTH = {width};
export const ATLAS_HEIGHT = {height};
/** SHA-256 of the exact generated atlas PNG bytes. */
export const ATLAS_CONTENT_SHA256 = '{png_sha256}';
/** Content-addressed public pathname; Pages ignores query strings in its cache key. */
export const ATLAS_FILE_NAME = '{revisioned_atlas_name(png_sha256)}';

export const SPRITES: readonly AtlasSprite[] = [
{body}
];

/**
 * The index of a sprite the shell itself draws by name, including lot
 * geometry and presentation overlays such as rings and indicators.
 *
 * Smart-object render rows must NOT derive their sprite through here. Their
 * sprite is content, so it arrives already resolved in the render buffer.
 * Presentation profiles may resolve a named atlas slot, then compare it with
 * that resolved column; they must not infer an object's sprite from kind or id.
 *
 * Throws rather than returning -1: an unknown name is a build mistake,
 * and -1 would index the uniform array out of range, which WGSL clamps
 * instead of trapping - so the whole floor would silently draw as some
 * other sprite.
 */
export function spriteIndex(name: string): number {{
  const index = SPRITES.findIndex((sprite) => sprite.name === name);
  if (index < 0) {{
    throw new Error(`the sprite atlas has no sprite named ${{name}}`);
  }}
  return index;
}}
"""


def png_bytes(sheet):
    buf = io.BytesIO()
    sheet.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def png_check_error(path, sheet):
    """Describe a missing or stale PNG while ignoring byte packaging."""
    try:
        with Image.open(path) as image:
            existing = image.convert("RGBA")
            matches = (
                existing.size == sheet.size
                and existing.tobytes() == sheet.tobytes()
            )
    except FileNotFoundError:
        return f"{path}: missing"
    except (OSError, ValueError):
        return f"{path}: pixels differ from a fresh build"

    if not matches:
        return f"{path}: pixels differ from a fresh build"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if regenerating would change anything")
    args = ap.parse_args()

    sprites = render_all()
    names = [s[0] for s in sprites]
    if len(set(names)) != len(names):
        sys.exit("duplicate sprite name in objects.SPRITES")

    placed, width, height = pack(sprites)
    sheet = compose(sprites, placed, width, height)
    png = png_bytes(sheet)
    toml = write_toml(sprites, placed, width, height)
    # The revision is part of the atlas PATH, so hashed JavaScript can never
    # request a cached PNG from an older deployment. GitHub Pages' edge cache
    # ignores query strings. In check mode, hash the exact committed bytes when
    # their decoded pixels are current. That keeps the existing cross-Pillow
    # tolerance for harmless PNG packaging changes while still requiring
    # atlas.ts to identify the bytes Pages will serve.
    png_for_revision = png
    png_error = None
    if args.check:
        png_error = png_check_error(ATLAS_PNG, sheet)
        if png_error is None:
            try:
                with open(ATLAS_PNG, "rb") as fh:
                    png_for_revision = fh.read()
            except OSError:
                png_error = f"{ATLAS_PNG}: missing"
    png_sha256 = hashlib.sha256(png_for_revision).hexdigest()
    revisioned_png = os.path.join(
        os.path.dirname(ATLAS_PNG), revisioned_atlas_name(png_sha256)
    )
    ts = write_ts(sprites, placed, width, height, png_sha256)

    if args.check:
        bad = []
        if png_error:
            bad.append(png_error)
        try:
            with open(revisioned_png, "rb") as fh:
                revisioned_have = fh.read()
        except OSError:
            bad.append(f"{revisioned_png}: missing")
        else:
            if revisioned_have != png_for_revision:
                bad.append(f"{revisioned_png}: does not match atlas.png bytes")
        stale_revisioned = [
            path for path in revisioned_atlas_paths() if path != revisioned_png
        ]
        for path in stale_revisioned:
            bad.append(f"{path}: obsolete content-addressed atlas")
        for path, want in ((ATLAS_TOML, toml), (ATLAS_TS, ts)):
            try:
                with open(path, "r") as fh:
                    have = fh.read()
            except OSError:
                bad.append(f"{path}: missing")
                continue
            if have != want:
                bad.append(f"{path}: differs from a fresh build")
        if bad:
            sys.exit("atlas is stale:\n  " + "\n  ".join(bad) +
                     "\nRun: python3 assets/sprites/gen/build.py")
        print(f"atlas is up to date: {len(sprites)} sprites, {width}x{height}")
        return

    for path in revisioned_atlas_paths():
        if path != revisioned_png:
            os.remove(path)
    with open(ATLAS_PNG, "wb") as fh:
        fh.write(png)
    with open(
        os.path.join(os.path.dirname(ATLAS_PNG), revisioned_atlas_name(png_sha256)),
        "wb",
    ) as fh:
        fh.write(png)
    with open(ATLAS_TOML, "w") as fh:
        fh.write(toml)
    with open(ATLAS_TS, "w") as fh:
        fh.write(ts)
    print(f"wrote {len(sprites)} sprites into {width}x{height} "
          f"({len(png) // 1024} KB)")
    for name, _, w, h in sprites:
        print(f"  {name:32s} {w:>4} x {h:>4}")


if __name__ == "__main__":
    main()
