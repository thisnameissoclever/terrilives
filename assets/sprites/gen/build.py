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
from pathlib import Path
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageChops                              # noqa: E402
from coverage_table import coverage_table

import objects                                                  # noqa: E402
import front_door                                               # noqa: E402
from iso import canvas, emit                                    # noqa: E402
from offline_sims import load_export, runtime_tables, trim_clip_envelopes  # noqa: E402
from offline_furniture import load_furniture, furniture_tables  # noqa: E402
from offline_batches import load_batches                       # noqa: E402
from offline_props import load_props                           # noqa: E402
from aquarium_motion import validate_aquarium_motion            # noqa: E402
from offline_armchair import load_reviewed_armchair             # noqa: E402
from offline_architecture import sync_generated_architecture    # noqa: E402
from offline_double_bed import append_layers, append_scene_records
from style import TILE_HALF_WIDTH, TILE_HALF_HEIGHT             # noqa: E402
from rectangle_packing import pack_rectangles                  # noqa: E402
from atlas_pages import pack_pages
from offline_covered_bunk import load_covered_bunk, append as append_covered_bunk

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
# (`DINNER_PIXELS_SHA256`). Chat frames stay put; the 0 through 171 complement moves
# because the furniture on those indices was redrawn in place.
CHAT_PIXELS_SHA256 = (
    "33be03b782c6d89525ed11737a880793a01b461fc79e1cdd2d1adf45c75c2fee"
)
DINNER_PIXELS_SHA256 = (
    "1ac2f0505b58157e42d72de325100e20f5742a1b24c5dfa43592ec58d9ebd4dd"
)
# The decoded-record baseline for indices 0 through 171, excluding the split
# bunk at 11 plus the bike and aquarium replacements at 24 and 32. Atlas
# coordinates are packing output and deliberately absent.
AQUARIUM_BIKE_COMPLEMENT_SHA256 = (
    "db322747a0016ca586eb2b890350d91ab18387b986f20896251db0a3aed26d14"
)
# Corrective-candidate replacement pixels: four bike facings, both aquarium
# frames, and every exercise body. The broader complement guard cannot cover
# these deliberate exceptions, which is exactly how a later shared character
# pass silently turned pedalling back into a standing bob.
AQUARIUM_BIKE_REPAIR_SHA256 = (
    # Lower grips fit the approved rider while retaining the original horizontal
    # envelope. The adjacent lot wall is checked in test_exercise_wall.py.
    "4f3cfa5bd967c411188472867f10ce530eee4509bbfb800cdcaec31343bab545"
)
# Reviewed armchair-sitting bodies: every look, facing, and restrained frame.
# This closes the shared-generator gap for the exact pixels accepted in the
# local played composite rather than merely protecting their dimensions.
SITTING_PIXELS_SHA256 = (
    "6ee262065cba617b033a40a0f781402d3500ca5d961ccb154d6359f2796a171f"
)
# Reviewed lower-bunk foreground plus every horizontal sleeping body. Filled
# from decoded records, not packed coordinates or PNG encoder output.
SLEEPING_PIXELS_SHA256 = (
    "dd75d83e0947596d5cb63d5aad2eade66bc913f1414aff418f4a243fced92632"
)
# Reviewed fixed frame plus closed, ajar, and open left-hinged leaf states.
FRONT_DOOR_PIXELS_SHA256 = (
    "8bd47d4e4e07f4b954b02f088fef482216608110b12edf60f10519b40310b64d"
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


def sitting_names():
    return [
        f"{look}Sit{facing}{frame}"
        for look in ("sim", "sim2", "sim3")
        for facing in ("SE", "NW", "SW", "NE")
        for frame in (0, 1)
    ]


def sleeping_names():
    return [
        f"{look}Sleep{facing}{frame}"
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


def rgba_difference(left, right, box):
    """Count pixels whose full decoded RGBA value differs inside ``box``."""
    a = left.crop(box).tobytes()
    b = right.crop(box).tobytes()
    return sum(a[i:i + 4] != b[i:i + 4] for i in range(0, len(a), 4))


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

    # Only the split bunk, bike and aquarium records may change in the shipped
    # 0 through 171 range. Everything new appends after the fixed prefix.
    protected_existing = [
        sprite for index, sprite in enumerate(sprites[:172])
        if index not in (11, 24, 32)
    ]
    complement_digest = sprite_record_digest(protected_existing)
    if complement_digest != AQUARIUM_BIKE_COMPLEMENT_SHA256:
        raise SystemExit(
            "decoded pixels changed outside the bunk, bike and aquarium: "
            + complement_digest
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
    if bike[0].getchannel("A").getbbox() != (1, 37, 55, 88):
        raise SystemExit("exercise bike lost its planted, rider-fitted envelope")
    for name, expected in (
        ("cardboardBoxOpenSW", (26, 37, 80, 88)),
        ("cardboardBoxOpenNW", (26, 37, 80, 88)),
        ("cardboardBoxOpenNE", (1, 37, 55, 88)),
    ):
        image, width, height = by_name[name]
        if (width, height) != (80, 88):
            raise SystemExit(f"{name} must share the bike's 80x88 envelope")
        if image.getchannel("A").getbbox() != expected:
            raise SystemExit(f"{name} lost its rider-fitted silhouette")
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
        (50, 51, 65, 58),
        (57, 61, 71, 68),
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

    for stem, action_names, motion_box, minimum, difference_count in (
        ("Exercise", exercise, (0, 50, 38, 78), 24, rgba_difference),
        ("WatchFish", watch, (0, 0, 38, 88), 12, alpha_difference),
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
                if difference_count(quiet, active, motion_box) < minimum:
                    raise SystemExit(
                        f"{look}{stem}{facing}: the two silhouettes barely move"
                    )
                if stem == "Exercise" and (
                    quiet.crop((0, 0, 38, 50)).tobytes()
                    != active.crop((0, 0, 38, 50)).tobytes()
                ):
                    raise SystemExit(
                        f"{look}{stem}{facing}: pedalling moved the planted upper body"
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

    # Keep the focused geometry and motion errors above actionable. This final
    # digest then catches visual regressions that remain valid silhouettes,
    # such as restoring the rejected roof or changing the reviewed palette.
    protected_repair = [
        (name, *by_name[name])
        for name in (
            "cardboardBoxOpen",
            "cardboardBoxOpenSW",
            "cardboardBoxOpenNW",
            "cardboardBoxOpenNE",
            "bookcaseClosedWide",
            "aquariumCabinet1",
            *exercise,
        )
    ]
    if sprite_record_digest(protected_repair) != AQUARIUM_BIKE_REPAIR_SHA256:
        raise SystemExit(
            "corrective aquarium, bike, or pedalling pixels changed"
        )


def validate_sitting_contract(sprites):
    """Keep the appended armchair pose fixed, directional, and readable."""
    names = [name for name, _, _, _ in sprites]
    sitting = sitting_names()
    if names[311:335] != sitting:
        raise SystemExit("sitting bodies must append at indices 311 through 334")

    by_name = {
        name: (image, width, height)
        for name, image, width, height in sprites
    }
    reviewed = [(name, *by_name[name]) for name in sitting]
    if sprite_record_digest(reviewed) != SITTING_PIXELS_SHA256:
        raise SystemExit("reviewed armchair-sitting pixels changed")

    for name in sitting:
        image, width, height = by_name[name]
        if (width, height) != (38, 88):
            raise SystemExit(f"{name}: sitting body must be exactly 38x88")
        bounds = image.getchannel("A").getbbox()
        if bounds is None or bounds[3] != 88:
            raise SystemExit(f"{name}: sitting body lost its planted contact row")

    for look in ("sim", "sim2", "sim3"):
        for facing in ("SE", "NW", "SW", "NE"):
            quiet = by_name[f"{look}Sit{facing}0"][0]
            active = by_name[f"{look}Sit{facing}1"][0]
            changed = rgba_difference(quiet, active, (0, 24, 38, 64))
            if not 8 <= changed <= 100:
                raise SystemExit(
                    f"{look}Sit{facing}: hand adjustment changed {changed} pixels"
                )

        for frame in (0, 1):
            facings = {
                by_name[f"{look}Sit{facing}{frame}"][0]
                .getchannel("A")
                .tobytes()
                for facing in ("SE", "NW", "SW", "NE")
            }
            if len(facings) != 4:
                raise SystemExit(
                    f"{look} sitting frame {frame}: directional silhouettes match"
                )


def validate_sleeping_contract(sprites):
    """Pin lower-bunk occlusion, horizontal envelopes, and calm movement."""
    names = [name for name, _, _, _ in sprites]
    sleeping = sleeping_names()
    if names[335] != "bedBunkForeground":
        raise SystemExit("the bunk foreground must append at atlas index 335")
    if names[336:360] != sleeping or len(names) < 360:
        raise SystemExit("sleeping bodies must append at indices 336 through 359")

    by_name = {
        name: (image, width, height)
        for name, image, width, height in sprites
    }
    reviewed = [
        (name, *by_name[name])
        for name in ("bedBunk", "bedBunkForeground", *sleeping)
    ]
    digest = sprite_record_digest(reviewed)
    if digest != SLEEPING_PIXELS_SHA256:
        raise SystemExit(
            "reviewed lower-bunk sleep pixels changed: " + digest
        )

    base, base_w, base_h = by_name["bedBunk"]
    foreground, foreground_w, foreground_h = by_name["bedBunkForeground"]
    if (base_w, base_h) != (122, 136):
        raise SystemExit("bedBunk background must remain exactly 122x136")
    if (foreground_w, foreground_h) != (122, 136):
        raise SystemExit("bedBunkForeground must be exactly 122x136")
    complete_canvas, complete_draw = canvas()
    objects._bunk(complete_draw, "se", "complete")
    complete, width, height = emit(complete_canvas, 122, 136)
    if (width, height) != (122, 136):
        raise SystemExit("complete bunk comparison changed dimensions")
    if Image.alpha_composite(base, foreground).tobytes() != complete.tobytes():
        raise SystemExit("bedBunk plus foreground no longer reconstructs the bunk")

    for name in sleeping:
        image, width, height = by_name[name]
        if (width, height) != (104, 72):
            raise SystemExit(f"{name}: sleeping body must be exactly 104x72")
        bounds = image.getchannel("A").getbbox()
        if bounds is None or bounds[2] - bounds[0] < 64:
            raise SystemExit(f"{name}: sleeping silhouette is not horizontal")
        if bounds[3] - bounds[1] > 48:
            raise SystemExit(f"{name}: sleeping silhouette became upright")

    for look in ("sim", "sim2", "sim3"):
        for facing in ("SE", "NW", "SW", "NE"):
            quiet = by_name[f"{look}Sleep{facing}0"][0]
            active = by_name[f"{look}Sleep{facing}1"][0]
            changed = rgba_difference(quiet, active, (0, 0, 104, 72))
            if not 8 <= changed <= 120:
                raise SystemExit(
                    f"{look}Sleep{facing}: breathing changed {changed} pixels"
                )

        for frame in (0, 1):
            facings = {
                by_name[f"{look}Sleep{facing}{frame}"][0]
                .getchannel("A")
                .tobytes()
                for facing in ("SE", "NW", "SW", "NE")
            }
            if len(facings) != 4:
                raise SystemExit(
                    f"{look} sleeping frame {frame}: directional silhouettes match"
                )


def validate_joined_walls_contract(sprites):
    """Preserve every old record and keep door seams identical to the wall."""
    # Decoded atlas prefix from origin/main a3559cd, including imported Sims.
    baseline = "45a92314006d068ccdebeea9aad862ada6fbe659c2240f2ab384245640a84a23"
    if sprite_record_digest(sprites[:836]) != baseline:
        raise SystemExit("joined walls changed a legacy sprite record")
    expected = [f"wallJoin{mask}" for mask in (3, 6, 7, 9, 11, 12, 13, 14, 15)]
    expected += ["doorwayJoinedNS", "doorwayJoinedEW"]
    expected += ["wallCornerStartNS", "wallCornerStartEW"]
    if [record[0] for record in sprites[836:]] != expected:
        raise SystemExit("joined architecture must append after sprite 835")
    by_name = {name: image for name, image, _, _ in sprites}
    for mask in (3, 6, 7, 9, 11, 12, 13, 14, 15):
        image = by_name[f"wallJoin{mask}"]
        if image.size != (32, 98 if mask == 6 else 109):
            raise SystemExit("joined wall lost its panel envelope")
        for bit, x, y in ((1, 0, -.4), (2, .4, 0), (4, 0, .4), (8, -.4, 0)):
            # Probe just below the top of each arm, away from its shared join.
            px = round(16 + (x - y) * TILE_HALF_WIDTH)
            py = round(image.height - 22 + (x + y) * TILE_HALF_HEIGHT - 1.9 * 38)
            alpha = image.getpixel((px, py))[3] if 0 <= py < image.height else 0
            if mask & bit and alpha != 255:
                raise SystemExit("joined wall omits a connected arm")
            if bit in (1, 8) and not mask & bit and alpha != 0:
                raise SystemExit("joined wall adds an unconnected far arm")
    for axis in ("NS", "EW"):
        wall = by_name[f"wall{axis}"]
        door = by_name[f"doorwayJoined{axis}"]
        if door.size != wall.size:
            raise SystemExit("doorway and wall panel dimensions must agree")
        # The frame must enclose an opening, with solid wall above it.
        if door.getpixel((16, 62))[3] != 0 or door.getpixel((16, 26))[3] != 255:
            raise SystemExit("doorway lost its open passage or solid lintel")
        for x in (0, wall.width - 1):
            if wall.crop((x, 0, x + 1, wall.height)).tobytes() != door.crop((x, 0, x + 1, door.height)).tobytes():
                raise SystemExit("doorway adds a seam at the panel edge")


def render_sprites(drawers, exact=None):
    exact = objects.EXACT if exact is None else exact
    out = []
    for fn in drawers:
        img, d = canvas()
        fn(d)
        ew, eh = exact.get(fn.__name__, (None, None))
        try:
            crop, w, h = emit(img, ew, eh)
        except ValueError as err:
            raise SystemExit(f"{fn.__name__}: {err}") from err
        out.append((fn.__name__, crop, w, h))
    return out


def append_front_door_sprites(sprites):
    """Append the portal after every existing atlas record."""
    start = len(sprites)
    records = render_sprites(front_door.SPRITES, exact=front_door.EXACT)
    if [record[0] for record in records] != [
        "frontDoorFrameSELeft",
        "frontDoorClosedSELeft",
        "frontDoorAjarSELeft",
        "frontDoorOpenSELeft",
    ]:
        raise SystemExit("front-door sprite order changed")
    if any((record[2], record[3]) != front_door.ENVELOPE for record in records):
        raise SystemExit("front-door sprites lost their shared envelope")
    if len({record[1].tobytes() for record in records[1:]}) != 3:
        raise SystemExit("closed, ajar, and open door leaves must differ")
    if sprite_record_digest(records) != FRONT_DOOR_PIXELS_SHA256:
        raise SystemExit("reviewed front-door pixels changed")
    sprites.extend(records)
    return start


def render_all():
    out = render_sprites(objects.SPRITES)
    validate_reading_contract(out)
    validate_animation_repair_contract(out)
    validate_aquarium_bike_contract(out)
    validate_sitting_contract(out)
    validate_sleeping_contract(out)
    return out


class AtlasHeightError(ValueError):
    """The next supported atlas width may fit the same records."""


def deduplicate_pixels(sprites):
    """Share texture rectangles only when dimensions and decoded RGBA agree."""
    unique = []
    aliases = []
    candidates = {}
    for sprite in sprites:
        _, image, width, height = sprite
        pixels = image.convert('RGBA').tobytes()
        key = (width, height, hashlib.sha256(pixels).digest())
        canonical = next((index for index in candidates.get(key, [])
                          if unique[index][1].convert('RGBA').tobytes() == pixels), None)
        if canonical is None:
            canonical = len(unique)
            unique.append(sprite)
            candidates.setdefault(key, []).append(canonical)
        aliases.append(canonical)
    return unique, aliases


def pack_atlas(sprites):
    """Choose the smallest supported width without relaxing the 8192 ceiling."""
    for width in (2048, 4096, 8192):
        candidates = []
        try:
            candidates.append(pack(sprites, width))
        except ValueError:
            pass
        try:
            candidates.append(pack_rectangles([(sprite[2], sprite[3]) for sprite in sprites], width, 8192, PADDING))
        except ValueError:
            pass
        if candidates:
            return min(candidates, key=lambda result: result[2])
    raise AtlasHeightError('atlas height exceeds texture dimension limit')


def pack(sprites, width=512):
    """Pack tallest first and fill existing shelf gaps before adding height."""
    if not 1 <= width <= 8192 or any(sprite[2] + PADDING > width for sprite in sprites):
        raise ValueError("atlas width exceeds texture dimension limit")
    order = sorted(range(len(sprites)), key=lambda i: -sprites[i][3])
    shelves = []
    height = 0
    placed = {}
    for i in order:
        _, _, w, h = sprites[i]
        candidates = [s for s in shelves if s['height'] >= h and s['x'] + w + PADDING <= width]
        if candidates:
            shelf = max(candidates, key=lambda s: s['x'])
        else:
            shelf = dict(x=0, y=height, height=h)
            shelves.append(shelf)
            height += h + PADDING
        placed[i] = (shelf['x'], shelf['y'])
        shelf['x'] += w + PADDING
    if height > 8192:
        raise AtlasHeightError("atlas height exceeds texture dimension limit")
    return placed, width, height


LEGACY_SIM_BODY = re.compile(r"sim[23]?(?=[A-Z]|$)")


def sim_body_indices(sprites, legacy_count, variants):
    """Every Sim body frame: the legacy figures and each rigged clip sample."""
    legacy = {index for index in range(legacy_count)
              if LEGACY_SIM_BODY.match(sprites[index][0])}
    rigged = {index for clips in variants.values() for clip in clips.values()
              for facing in clip["frames"] for index in facing}
    return legacy | rigged


def fill_padded_bounds(sprites, densities, bounds, whole_canvas=frozenset()):
    """Cut the transparent band above the art off every box-less sprite.

    Picking and camera framing fall back to the whole canvas without a box,
    so empty space above a sprite acts as part of the object and lifts the
    camera and the placement buttons off its art. The importers record boxes
    only for the sprites they were written for; this covers every other one.

    Only the band above the art is cut. The sides and the base stay on the
    canvas, because a sprite stands on the south half of its tile and draws
    nothing there: trimming to the art would take the front of the trashcan's
    own tile out of its click target. Recorded boxes are kept, an occupied
    body's box deliberately excludes the furniture drawn with it, and sprites
    in `whole_canvas` keep the whole canvas, because a Sim's animation frames
    share one envelope and its click target must not move between frames.
    """
    for index, (_, image, w, h) in enumerate(sprites):
        if index in bounds or index in whole_canvas:
            continue
        art = image.getchannel("A").getbbox()
        if art is None or art[1] == 0:
            continue
        density = densities.get(index, 1)
        bounds[index] = [value / density if density != 1 else value
                         for value in (0, art[1], w, h)]


def compose(sprites, placed, width, height):
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for i, (_, crop, w, h) in enumerate(sprites):
        # Packed rectangles do not overlap. Copy straight RGBA unchanged;
        # using alpha as a second mask darkens antialiased model edges.
        sheet.paste(crop, placed[i])
    return sheet


def write_toml(sprites, placed, width, height, densities=None, pages=None, page_files=None):
    lines = [
        "# GENERATED by assets/sprites/gen/build.py. Do not edit by hand.",
        "#",
        "# The atlas manifest terri-data validates every object's `sprite`",
        "# field against, and resolves to the index the render buffer",
        "# carries. That index is the position of the [[sprite]] block",
        "# below, counting from 0, so reordering this file renumbers every",
        "# sprite after the change.",
        "#",
        "# x, y, w and h are physical texels in the selected texture page.",
        "# Logical size is w/h divided by pixel_density (default 1).",
        "",
        'image = "atlas.png"',
        f"width = {width}",
        f"height = {height}",
    ]
    if page_files is not None:
        lines.append('pages = '+json.dumps(page_files))
    for i, (name, _, w, h) in enumerate(sprites):
        px, py = placed[i]
        lines += ["", "[[sprite]]", f'name = "{name}"',
                  f"x = {px}", f"y = {py}", f"w = {w}", f"h = {h}"]
        if pages is not None:
            lines.append(f"page = {pages[i]}")
        if (densities or {}).get(i, 1) != 1:
            lines.append(f"pixel_density = {densities[i]}")
    return "\n".join(lines) + "\n"


def write_ts(sprites, placed, width, height, png_sha256, anchors=None,
             hands=None, tops=None, clips=None, hand_fronts=None, variants=None, densities=None,
             pairs=None, interactions=None, bounds=None, surfaces=None, bed_catalog=None, bed_layers=None, bed_coverage=None,
             pair_coverage=None, pair_masks=None, dining_meals=None, pages=None, page_files=None, bed_trims=None,
             seating_profiles=None, seating_layers=None, seating_coverage=None, seating_masks=None,
             shelf_profiles=None, shelf_slots=None, shelf_coverage=None,
             shared_seat_catalog=None, shared_seat_layers=None, shared_seat_preview=None,
             joint_scene_alpha_ids=None, reading_body_catalog=None, dropped_book_sprites=None, sofa_recline_catalog=None,
             bathroom_profiles=None, bathroom_layers=None, bathroom_coverage=None, bathroom_masks=None,
             book_reach_catalog=None, book_reach_shelves=None):
    rows = []
    for i, (name, _, w, h) in enumerate(sprites):
        px, py = placed[i]
        density = f", pixel_density: {densities[i]}" if i in (densities or {}) else ""
        page = f", page: {pages[i]}" if pages is not None else ""
        rows.append(f"  atlasSprite({{ name: '{name}', x: {px}, y: {py}, w: {w}, h: {h}{density}{page} }}),")
    body = "\n".join(rows)
    anchor_rows = "\n".join(
        f"  {index}: [{point[0]}, {point[1]}],"
        for index, point in sorted((anchors or {}).items())
    )
    hands_json = json.dumps(hands or {}, indent=2)
    hand_fronts_json = json.dumps(hand_fronts or {}, indent=2)
    tops_json = json.dumps(tops or {}, indent=2)
    clips_json = json.dumps(clips or {}, indent=2)
    variants_json = json.dumps(variants or {}, indent=2)
    pairs_json = json.dumps(pairs or {}, indent=2)
    interactions_json = json.dumps(interactions or {}, indent=2)
    bounds_json = json.dumps(bounds or {}, indent=2)
    surfaces_json = json.dumps(surfaces or {}, indent=2)
    bed_catalog_json = json.dumps(bed_catalog or {}, indent=2)
    bed_layers_json = json.dumps(bed_layers or {}, indent=2)
    coverage_values, coverage_indices = coverage_table(bed_coverage or [])
    bed_coverage_json = json.dumps(coverage_values, separators=(',', ':'))
    pair_coverage_json = json.dumps(pair_coverage or {}, indent=2)
    pair_masks_json = json.dumps(pair_masks or [], indent=2)
    dining_meals_json = json.dumps(dining_meals or {}, indent=2)
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

/** One packed sprite. `w` and `h` are physical texture pixels. */
export interface AtlasSprite {{
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pixel_density?: number;
  readonly page?: number;
}}

function atlasSprite(sprite: AtlasSprite): AtlasSprite {{ return sprite; }}

export const ATLAS_WIDTH = {width};
export const ATLAS_HEIGHT = {height};
/** SHA-256 of the exact generated atlas PNG bytes. */
export const ATLAS_CONTENT_SHA256 = '{png_sha256}';
/** Content-addressed public pathname; Pages ignores query strings in its cache key. */
export const ATLAS_FILE_NAME = '{revisioned_atlas_name(png_sha256)}';
export const ATLAS_PAGE_FILES: readonly string[] = {json.dumps(page_files or [revisioned_atlas_name(png_sha256)])};
export const BED_LAYER_TRIMS: Readonly<Record<number, readonly [number, number]>> = {json.dumps(bed_trims or {}, indent=2)};

export const SPRITES: readonly AtlasSprite[] = [
{body}
];

/** Registered pixel anchors; omitted legacy records remain bottom-centred. */
export const SPRITE_ANCHORS: Readonly<Record<number, readonly [number, number]>> = {{
{anchor_rows}
}};

/** Actual opaque top and gripping point in logical image coordinates. */
export const SPRITE_CONTENT_TOPS: Readonly<Record<number, number>> = {tops_json};
/**
 * The box picking and camera framing use inside a sprite's canvas.
 *
 * A sprite whose art reaches its canvas top is absent, and so is a Sim body
 * frame, which keeps its whole canvas so that a Sim's click target does not
 * move between animation frames. Every other sprite has a box: the generated
 * ones are cut to the art top and keep the canvas sides and base, and the
 * imported ones are the art's own box, an occupied Sim's excluding the
 * furniture silhouette.
 */
export const SPRITE_CONTENT_BOUNDS: Readonly<Record<number, readonly [number, number, number, number]>> = {bounds_json};
/** Indices of premultiplied visibility contributions composed in one fragment. */
export const SPRITE_PAIRS: Readonly<Record<number, {{ readonly furniture: number; readonly outline: number }}>> = {pairs_json};
/** Raw visible body and furniture ownership, sampled in the paired canvas. */
export const SPRITE_PAIR_COVERAGE: Readonly<Record<number, readonly [number, number, number, number]>> = {pair_coverage_json};
export const SPRITE_PAIR_MASKS: readonly import('./bed-sprites.js').EncodedCoverage[] = {pair_masks_json};
/** Visible meal contributions use their actual table's depth while retaining the diner anchor. */
export const SPRITE_DINING_SUPPORT: Readonly<Record<number, import('./dining-support.js').DiningSupport>> = {dining_meals_json};
/** Exact empty-sprite profiles; explicit body indices retain shared-layer deduplication. */
export const INTERACTION_SPRITES: import('./interaction-sprites.js').InteractionCatalog = {interactions_json};
/** Furniture support points projected from its authored surface and camera. */
export const BED_CATALOG: import('./bed-sprites.js').BedCatalog = {bed_catalog_json};
export const BED_LAYERS: Readonly<Record<number, readonly [number, number, number, number]>> = {bed_layers_json};
const COVERAGE_VALUES: readonly import('./bed-sprites.js').EncodedCoverage[] = {bed_coverage_json};
export const BED_COVERAGE: readonly import('./bed-sprites.js').EncodedCoverage[] = {json.dumps(coverage_indices, separators=(',', ':'))}.map(index => COVERAGE_VALUES[index]!);
/** Action-specific neutral seating retains existing reading and dining profiles. */
export const SEATING_SPRITES: import('./interaction-sprites.js').ActionInteractionCatalog = {json.dumps(seating_profiles or {}, indent=2)};
export const SEATING_LAYERS: Readonly<Record<number, readonly [number, number, number, number]>> = {json.dumps(seating_layers or {}, indent=2)};
export const SEATING_COVERAGE: Readonly<Record<number, readonly [number, number, number, number]>> = {json.dumps(seating_coverage or {}, indent=2)};
export const SEATING_MASKS: readonly import('./bed-sprites.js').EncodedCoverage[] = {json.dumps(seating_masks or [], indent=2)};
export const SHELF_PROFILES: import('./shelf-sprites.js').ShelfProfiles = {json.dumps(shelf_profiles or {}, indent=2)};
export const SHELF_COVERAGE: Readonly<Record<number, import('./bed-sprites.js').EncodedCoverage>> = {json.dumps(shelf_coverage or {}, indent=2)};
export const SHELF_SLOT_TRANSFORMS = {json.dumps(shelf_slots or {}, separators=(',', ':'))};
export const BOOK_REACH_CATALOG: import('./book-reach-sprites.js').BookReachCatalog = {json.dumps(book_reach_catalog or {}, separators=(',', ':'))};
export const BOOK_REACH_SHELVES: import('./book-reach-sprites.js').BookReachShelves = {json.dumps(book_reach_shelves or {}, separators=(',', ':'))};
export const SHARED_SEAT_CATALOG: import('./shared-seat-sprites.js').SharedSeatCatalog = {json.dumps(shared_seat_catalog or {}, separators=(',', ':'))};
export const SHARED_SEAT_LAYERS: import('./visible-scene-layers.js').SharedSceneLayers = {json.dumps(shared_seat_layers or {}, separators=(',', ':'))};
/** Explicit partial catalogue for renderer review; normal game selection does not consume it. */
export const SHARED_SEAT_PREVIEW_CATALOG: import('./shared-seat-sprites.js').SharedSeatCatalog = {json.dumps(shared_seat_preview or {}, separators=(',', ':'))};
export const JOINT_SCENE_ALPHA_IDS: Readonly<Record<number, number>> = {json.dumps(joint_scene_alpha_ids or {})};
export const READING_BODY_CATALOG: import('./reading-sprites.js').ReadingBodyCatalog = {json.dumps(reading_body_catalog or {}, separators=(',', ':'))};
export const DROPPED_BOOK_SPRITES: readonly {{ readonly sprite: number; readonly alpha: number }}[] = {json.dumps(dropped_book_sprites or [])};
export const SOFA_RECLINE_CATALOG: import('./shared-seat-sprites.js').ReclineCatalog = {json.dumps(sofa_recline_catalog or {}, separators=(',', ':'))};
/** Fitted bathroom actions keep their ownership separate from older scenes. */
export const BATHROOM_SPRITES: import('./interaction-sprites.js').ActionInteractionCatalog = {json.dumps(bathroom_profiles or {}, indent=2)};
export const BATHROOM_LAYERS: Readonly<Record<number, readonly [number, number, number, number]>> = {json.dumps(bathroom_layers or {}, indent=2)};
export const BATHROOM_COVERAGE: Readonly<Record<number, readonly [number, number, number, number]>> = {json.dumps(bathroom_coverage or {}, indent=2)};
export const BATHROOM_MASKS: readonly import('./bed-sprites.js').EncodedCoverage[] = {json.dumps(bathroom_masks or [], indent=2)};
export const SURFACE_LAYOUTS: Readonly<Record<number, import('./surface-items.js').SurfaceLayout>> = {surfaces_json};
export const SPRITE_HAND_ANCHORS: Readonly<Record<number, readonly [number, number]>> = {hands_json};
/** Whether a held meal is nearer the camera than the body at its grip. */
export const SPRITE_HAND_FOREGROUND: Readonly<Record<number, boolean>> = {hand_fronts_json};

export interface RiggedSimClip {{
  readonly frames: readonly (readonly number[])[];
  readonly cycleTiles?: number;
}}

/** Runtime-facing order is +X, -X, +Y, -Y. */
export const RIGGED_SIM_CLIPS: Readonly<Record<string, RiggedSimClip>> = {clips_json};
/** Otherwise identical material variants, selected by persistent household identity. */
export const RIGGED_SIM_VARIANTS: Readonly<Record<string, Readonly<Record<string, RiggedSimClip>>>> = {variants_json};

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
    legacy_count = len(sprites)
    exported = load_export(
        os.path.join(ROOT, "assets", "models", "sims", "sim-01", "export", "manifest.json"),
        required_clips={"idle", "walk", "read", "talk", "eat", "stand_read", "watch_fish", "sit", "sleep"},
        existing_names={sprite[0] for sprite in sprites},
    )
    sprites.extend(exported.sprites)
    anchors, hands, tops, clips, hand_fronts = runtime_tables(exported, sprites)
    variants = {"green": clips}
    for variant in ("blue", "red"):
        colored = load_export(
            os.path.join(ROOT, "assets", "models", "sims", "sim-01", "export", variant, "manifest.json"),
            required_clips=set(exported.clips), expected_variant=variant,
            existing_names={sprite[0] for sprite in sprites},
        )
        if colored.clips != exported.clips:
            raise ValueError(f"{variant}: shirt variants must retain identical clip registration and timing")
        sprites.extend(colored.sprites)
        color_anchors, color_hands, color_tops, color_clips, color_fronts = runtime_tables(colored, sprites)
        anchors.update(color_anchors)
        hands.update(color_hands)
        tops.update(color_tops)
        hand_fronts.update(color_fronts)
        variants[variant] = color_clips
    exercise_registration = None
    for variant in ("green", "blue", "red"):
        exercise = load_export(
            os.path.join(ROOT, "assets", "models", "sims", "sim-01", "export", "exercise", variant, "manifest.json"),
            required_clips={"exercise"}, expected_variant=variant,
            existing_names={sprite[0] for sprite in sprites},
        )
        if set(exercise.clips) != {"exercise"}:
            raise ValueError("exercise supplement must not replace the approved base clips")
        if exercise_registration is None:
            exercise_registration = exercise.clips
        elif exercise.clips != exercise_registration:
            raise ValueError(f"{variant}: exercise registration and timing differ between shirt palettes")
        sprites.extend(exercise.sprites)
        extra_anchors, extra_hands, extra_tops, extra_clips, extra_fronts = runtime_tables(exercise, sprites)
        anchors.update(extra_anchors)
        hands.update(extra_hands)
        tops.update(extra_tops)
        hand_fronts.update(extra_fronts)
        variants[variant].update(extra_clips)
    # Append architecture after all imported bodies to preserve their indices.
    sprites.extend(render_sprites((
        *objects.WALL_JOIN_SPRITES, objects.doorwayJoinedNS, objects.doorwayJoinedEW,
        objects.wallCornerStartNS, objects.wallCornerStartEW,
    )))
    validate_joined_walls_contract(sprites)
    # Validate the native prefix first, then replace only the imported textures.
    # Both manifests remain registered in logical units; indices never move.
    densities = {}
    indices = {sprite[0]: i for i, sprite in enumerate(sprites)}
    export_root = os.path.join(ROOT, "assets", "models", "sims", "sim-01", "export")
    for relative, variant in (("", "green"), ("blue", "blue"), ("red", "red"),
                              ("exercise/green", "green"), ("exercise/blue", "blue"), ("exercise/red", "red")):
        native = load_export(os.path.join(export_root, relative, "manifest.json"), expected_variant=variant)
        dense = load_export(os.path.join(export_root, "hd", relative, "manifest.json"), expected_variant=variant)
        if dense.pixel_density != 2 or dense.clips != native.clips or dense.frames.keys() != native.frames.keys():
            raise ValueError("HD export must preserve native clips and frame names at density 2")
        for name, row in native.frames.items():
            logical = {key: value for key, value in row.items() if key not in ("sha256", "content_top")}
            if logical != {key: value for key, value in dense.frames[name].items() if key not in ("sha256", "content_top")}:
                raise ValueError(f"{name}: HD export changed logical frame metadata")
        for sprite in dense.sprites:
            index = indices[sprite[0]]
            sprites[index] = sprite
            densities[index] = dense.pixel_density
            tops[index] = dense.frames[sprite[0]]["content_top"]
    furniture = load_furniture(
        os.path.join(ROOT, "assets", "models", "furniture", "export", "manifest.json"),
        existing_names={sprite[0] for sprite in sprites},
    )
    sprites.extend(furniture.sprites)
    extra_anchors, extra_tops, bounds, extra_density, pairs, interactions = furniture_tables(furniture, sprites)
    anchors.update(extra_anchors)
    tops.update(extra_tops)
    densities.update(extra_density)
    for kind, batch in load_batches(
        os.path.join(ROOT, "assets", "models", "atlas-batches.json"),
        existing_names={sprite[0] for sprite in sprites},
    ):
        if kind == 'static':
            props, prop_anchors, prop_density, prop_bounds = batch
            for sprite in props:
                index = len(sprites)
                sprites.append(sprite)
                anchors[index] = prop_anchors[sprite[0]]
                densities[index] = prop_density[sprite[0]]
                bounds[index] = prop_bounds[sprite[0]]
        else:
            sprites.extend(batch.sprites)
            more_anchors, more_tops, more_bounds, more_density, more_pairs, more_profiles = furniture_tables(batch, sprites)
            anchors.update(more_anchors)
            tops.update(more_tops)
            bounds.update(more_bounds)
            densities.update(more_density)
            pairs.update(more_pairs)
            interactions.update(more_profiles)
    # Endpoint endcaps append after every imported asset; all prior indices stay fixed.
    sprites.extend(render_sprites(objects.WALL_HALF_SPRITES))
    append_front_door_sprites(sprites)
    # Corrections append new records so historical atlas indices and pixels stay fixed.
    import bookcase
    for facing in ("se", "sw", "nw", "ne"):
        name = "wallBookcase" + ("" if facing == "se" else facing.upper())
        image, drawing = canvas()
        bookcase.draw(drawing, facing)
        crop, width, height = emit(image)
        sprites.append((name, crop, width, height))
    import cutaway_walls
    sprites.extend(render_sprites(cutaway_walls.SPRITES, exact=cutaway_walls.EXACT))
    # Earlier static catalogs precede published procedural walls. This tail
    # catalog follows them so adding furniture cannot shift those wall indices.
    props, prop_anchors, prop_density, prop_bounds = load_props(
        os.path.join(ROOT, 'assets', 'models', 'static-props-03.json'),
        existing_names={sprite[0] for sprite in sprites},
    )
    for sprite in props:
        index = len(sprites)
        sprites.append(sprite)
        anchors[index] = prop_anchors[sprite[0]]
        densities[index] = prop_density[sprite[0]]
        bounds[index] = prop_bounds[sprite[0]]
    # Occupied armchair art follows the full published static tail.
    armchair = load_reviewed_armchair(
        os.path.join(ROOT, 'assets', 'models', 'living', 'armchair-reviewed.json'),
        existing_names={sprite[0] for sprite in sprites},
    )
    sprites.extend(armchair.sprites)
    more_anchors, more_tops, more_bounds, more_density, more_pairs, more_profiles = furniture_tables(armchair, sprites)
    anchors.update(more_anchors)
    tops.update(more_tops)
    bounds.update(more_bounds)
    densities.update(more_density)
    pairs.update(more_pairs)
    interactions.update(more_profiles)
    # This static tail follows the occupied armchair records already published.
    props, prop_anchors, prop_density, prop_bounds = load_props(
        os.path.join(ROOT, 'assets', 'models', 'static-props-04.json'),
        existing_names={sprite[0] for sprite in sprites},
    )
    for sprite in props:
        index = len(sprites)
        sprites.append(sprite)
        anchors[index] = prop_anchors[sprite[0]]
        densities[index] = prop_density[sprite[0]]
        bounds[index] = prop_bounds[sprite[0]]
    # Activity replacements follow the complete historical atlas. Logical sizes
    # stay 26px while density two keeps the strokes legible at camera zoom.
    import activity_icons
    for sprite in activity_icons.render_icons():
        densities[len(sprites)] = 2
        sprites.append(sprite)
    domestic_registration = None
    for variant in ("green", "blue", "red"):
        domestic = load_export(
            os.path.join(export_root, "domestic", variant, "manifest.json"),
            required_clips={"prepare", "cook", "wash"}, expected_variant=variant,
            existing_names={sprite[0] for sprite in sprites},
        )
        if domestic_registration is None:
            domestic_registration = domestic.clips
        elif domestic.clips != domestic_registration:
            raise ValueError(f"{variant}: domestic registration differs between shirt palettes")
        sprites.extend(domestic.sprites)
        extra_anchors, extra_hands, extra_tops, extra_clips, extra_fronts = runtime_tables(domestic, sprites)
        anchors.update(extra_anchors)
        hands.update(extra_hands)
        tops.update(extra_tops)
        hand_fronts.update(extra_fronts)
        variants[variant].update(extra_clips)
        for name, row in domestic.frames.items():
            index = next(index for index, sprite in enumerate(sprites) if sprite[0] == name)
            densities[index] = domestic.pixel_density
    from surface_items import load_dishes, layouts, load_pot, stove_layouts
    dishes, dish_anchor = load_dishes(ROOT)
    for sprite in dishes:
        anchors[len(sprites)] = dish_anchor
        densities[len(sprites)] = 2
        sprites.append(sprite)
    for variant in ('green', 'blue', 'red'):
        cleanup = load_export(os.path.join(ROOT, 'assets/models/domestic/export/cleanup', variant, 'manifest.json'),
                              required_clips={'carry_walk', 'carry_idle', 'wash'}, expected_variant=variant)
        indices = {sprite[0]: i for i, sprite in enumerate(sprites)}
        for sprite in cleanup.sprites:
            index = indices.get(sprite[0], len(sprites))
            if index == len(sprites):
                sprites.append(sprite)
            else:
                sprites[index] = sprite
            densities[index] = cleanup.pixel_density
        more_anchors, _, more_tops, more_clips, _ = runtime_tables(cleanup, sprites)
        anchors.update(more_anchors)
        tops.update(more_tops)
        variants[variant].update(more_clips)
    surfaces = layouts(ROOT, sprites)
    import door_assets
    for sprite in door_assets.records():
        densities[len(sprites)] = 3
        sprites.append(sprite)
    names = [s[0] for s in sprites]
    if len(set(names)) != len(names):
        sys.exit("duplicate sprite name in objects.SPRITES")
    fill_padded_bounds(sprites, densities, bounds,
                       sim_body_indices(sprites, legacy_count, variants))
    bounds = dict(sorted(bounds.items()))

    covered_bed, covered_indices = append_layers(sprites, anchors, densities,
        os.path.join(ROOT, 'assets/models/bedroom/export/double-bed-covered/manifest.json'))
    # Preserve published aliases before appending new textured dining records.
    provisional = {index: (0, 0) for index in range(len(sprites))}
    bed_catalog, bed_layers, bed_coverage = append_scene_records(
        sprites, provisional, anchors, densities, bounds, covered_bed, covered_indices)
    dining_exports = [load_export(os.path.join(ROOT, 'assets/models/domestic/export/dining', variant, 'manifest.json'),
                     required_clips={'food_walk', 'food_idle', 'seated_eat', 'cook_v2'}, expected_variant=variant)
                     for variant in ('green', 'blue', 'red')]
    for dining in trim_clip_envelopes(dining_exports):
        variant = dining.variant
        for sprite in dining.sprites:
            densities[len(sprites)] = dining.pixel_density
            sprites.append(sprite)
        more_anchors, _, more_tops, more_clips, _ = runtime_tables(dining, sprites)
        anchors.update(more_anchors)
        tops.update(more_tops)
        variants[variant].update(more_clips)
    pots,pot_anchor=load_pot(ROOT)
    for sprite in pots:
        anchors[len(sprites)]=pot_anchor
        densities[len(sprites)]=2
        sprites.append(sprite)
    surfaces.update(stove_layouts(ROOT,sprites))
    from offline_dining import load_dining, coverage_tables, meal_tables
    occupied = load_dining(os.path.join(ROOT, 'assets/models/domestic/export/seated-dining/manifest.json'),
                           existing_names={sprite[0] for sprite in sprites})
    sprites.extend(occupied.sprites)
    pair_coverage, pair_masks = coverage_tables(occupied, sprites)
    more_anchors, more_tops, more_bounds, more_density, more_pairs, more_profiles = furniture_tables(occupied, sprites)
    anchors.update(more_anchors)
    tops.update(more_tops)
    bounds.update(more_bounds)
    densities.update(more_density)
    pairs.update(more_pairs)
    interactions.update(more_profiles)
    for meal_sprite in occupied.meal_sprites:
        anchors[len(sprites)] = occupied.meal_anchors[meal_sprite[0]]
        densities[len(sprites)] = 2
        sprites.append(meal_sprite)
    dining_meals = meal_tables(occupied, sprites, pair_masks)
    # Aquarium frames append after every released sprite, including dining.
    props, prop_anchors, prop_density, prop_bounds = load_props(
        os.path.join(ROOT, 'assets', 'models', 'static-props-05.json'),
        existing_names={sprite[0] for sprite in sprites},
    )
    for sprite in props:
        index = len(sprites)
        sprites.append(sprite)
        anchors[index] = prop_anchors[sprite[0]]
        densities[index] = prop_density[sprite[0]]
        bounds[index] = prop_bounds[sprite[0]]
    validate_aquarium_motion(sprites)
    covered_bunk = load_covered_bunk(os.path.join(ROOT, 'assets/models/bedroom/covered-bunk-reviewed.json'))
    bed_trims = append_covered_bunk(covered_bunk, sprites, anchors, densities, bounds,
                                   bed_catalog, bed_layers, bed_coverage)
    swim_catalog = os.path.join(ROOT, 'assets/models/static-props-06.json')
    props, prop_anchors, prop_density, prop_bounds = load_props(
        swim_catalog, existing_names={sprite[0] for sprite in sprites})
    for sprite in props:
        index = len(sprites)
        sprites.append(sprite)
        anchors[index] = prop_anchors[sprite[0]]
        densities[index] = prop_density[sprite[0]]
        bounds[index] = prop_bounds[sprite[0]]
    from aquarium_motion import validate_swimming_catalog
    validate_swimming_catalog(sprites, swim_catalog)
    from offline_seating import load_neutral_seats, records as seating_records, tables as seating_tables
    seating = load_neutral_seats(Path(ROOT) / 'assets/models/seating/export/neutral-03/manifest.json')
    seating_rows = seating_records(seating)
    assert not {row[0] for row in sprites}.intersection(row[0] for row in seating_rows), 'duplicate neutral seating records'
    sprites.extend(seating_rows)
    seating_data = seating_tables(seating, sprites)
    anchors.update(seating_data['anchors'])
    tops.update(seating_data['tops'])
    bounds.update(seating_data['bounds'])
    densities.update(seating_data['density'])
    from offline_table_sitting import load_table_sitting
    sitting = load_table_sitting(os.path.join(ROOT, 'assets/models/domestic/table-sitting'))
    sprites.extend(sitting.sprites)
    a, t, b, d, p, profiles = furniture_tables(sitting, sprites)
    anchors.update(a); tops.update(t); bounds.update(b); densities.update(d); pairs.update(p)
    masks_for_sitting, sitting_masks = coverage_tables(sitting, sprites)
    mask_offset = len(pair_masks)
    pair_coverage.update({index: [value + mask_offset for value in mask] for index, mask in masks_for_sitting.items()})
    pair_masks.extend(sitting_masks)
    for chair, profile in profiles.items():
        interactions[chair]['idleFrames'] = profile['frames']
        for variant, frames in profile['frames'].items():
            dining_meals[frames[0]] = dining_meals[interactions[chair]['frames'][variant][0]]
    from offline_cleaning import load_cleaning, support_tables
    cleaning_exports, cleaning_bins, cleaning_anchors, cleaning_support = load_cleaning(Path(ROOT)/'assets/models/cleaning/export/manifest.json')
    for export in cleaning_exports:
        sprites.extend(export.sprites)
        more_anchors, _, more_tops, more_clips, _ = runtime_tables(export, sprites)
        anchors.update(more_anchors); tops.update(more_tops); variants[export.variant].update(more_clips)
        for offset, sprite in enumerate(export.sprites):
            densities[len(sprites)-len(export.sprites)+offset] = export.pixel_density
    for sprite in cleaning_bins:
        anchors[len(sprites)] = cleaning_anchors[sprite[0]]; densities[len(sprites)] = 2
        sprites.append(sprite)
    dining_meals.update(support_tables(sprites,cleaning_support,pair_masks))
    from offline_bathroom import load_bathroom, records as bathroom_records, tables as bathroom_tables
    bathroom = load_bathroom(Path(ROOT) / 'assets/models/bathroom/actions/export/toilet-05/manifest.json')
    bathroom_rows = bathroom_records(bathroom)
    assert not {row[0] for row in sprites}.intersection(row[0] for row in bathroom_rows), 'duplicate bathroom records'
    sprites.extend(bathroom_rows)
    bathroom_data = bathroom_tables(bathroom, sprites, anchors)
    anchors.update(bathroom_data['anchors'])
    tops.update(bathroom_data['tops'])
    bounds.update(bathroom_data['bounds'])
    densities.update(bathroom_data['density'])
    bath = load_bathroom(Path(ROOT) / 'assets/models/bathroom/actions/export/bath-05/manifest.json')
    bath_rows = bathroom_records(bath)
    assert not {row[0] for row in sprites}.intersection(row[0] for row in bath_rows), 'duplicate bath records'
    sprites.extend(bath_rows)
    bath_data = bathroom_tables(bath, sprites, anchors)
    anchors.update(bath_data['anchors'])
    tops.update(bath_data['tops'])
    bounds.update(bath_data['bounds'])
    densities.update(bath_data['density'])
    bathroom_data = dict(bathroom_data, profiles={**bathroom_data['profiles'], **bath_data['profiles']},
                         layers={**bathroom_data['layers'], **bath_data['layers']},
                         coverage={**bathroom_data['coverage'], **{index:[m+len(bathroom_data['masks']) for m in masks]
                                                                  for index, masks in bath_data['coverage'].items()}},
                         masks=bathroom_data['masks']+bath_data['masks'])
    visible_layers = {**bed_layers, **seating_data['layers'], **bathroom_data['layers']}
    fill_padded_bounds(sprites, densities, bounds,
                       sim_body_indices(sprites, legacy_count, variants))
    from offline_shelf import load_shelf
    shelf_data = load_shelf(Path(ROOT) / 'assets/models/bookcase/export/mask-09/manifest.json',
                           sprites, anchors, densities, bed_trims)
    from offline_reader_subset import append_subset
    reader_subset = append_subset(Path(ROOT) / 'assets/models/seating/reader-subset-01/export/manifest.json',
                                  sprites, anchors, densities, bed_trims, bounds, tops, bed_coverage)
    visible_layers.update(reader_subset['layers'])
    from offline_reading import append_actions, append_dropped
    reading_actions = append_actions(ROOT, sprites, anchors, densities, bed_trims, bounds, tops, bed_coverage)
    dropped_books = append_dropped(ROOT, sprites, anchors, densities, bounds, bed_coverage)
    visible_layers.update(reading_actions['layers'])
    sync_generated_architecture(sprites, check=args.check)
    textured = [(index, sprite) for index, sprite in enumerate(sprites)
                if index not in visible_layers and index not in shelf_data['positions']]
    dense_sprites, texture_aliases = deduplicate_pixels([sprite for _, sprite in textured])
    packed_pages, page_count = pack_pages([(row[2], row[3]) for row in dense_sprites], 2048, PADDING)
    width, height = 2048, 2048
    placed = {index: packed_pages[texture_aliases[dense]][1:] for dense, (index, _) in enumerate(textured)}
    pages = {index: packed_pages[texture_aliases[dense]][0] for dense, (index, _) in enumerate(textured)}
    for alias, layers in visible_layers.items():
        placed[alias] = placed[layers[0]]
        pages[alias] = pages[layers[0]]
    for alias in reader_subset['aliases'] | reading_actions['aliases']:
        placed[alias] = (0, 0)
        pages[alias] = 0
    sheets = [Image.new('RGBA', (width, height)) for _ in range(page_count)]
    for index, (_, image, _, _) in enumerate(dense_sprites):
        page, x, y = packed_pages[index]
        sheets[page].paste(image, (x, y))
    shelf_page_start = len(sheets)
    sheets.extend(shelf_data['sheets'])
    placed.update(shelf_data['positions'])
    pages.update({index: shelf_page_start + page for index, page in shelf_data['pages'].items()})
    pngs = [png_bytes(sheet) for sheet in sheets]
    if args.check:
        for index, sheet in enumerate(sheets):
            alias_path = ATLAS_PNG if index == 0 else os.path.join(os.path.dirname(ATLAS_PNG), f'atlas-page-{index}.png')
            error = png_check_error(alias_path, sheet)
            if error:
                raise ValueError(error)
            pngs[index] = Path(alias_path).read_bytes()
    page_files = [revisioned_atlas_name(hashlib.sha256(png).hexdigest()) for png in pngs]
    png, sheet = pngs[0], sheets[0]
    toml = write_toml(sprites, placed, width, height, densities=densities, pages=pages, page_files=page_files)
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
    ts = write_ts(sprites, placed, width, height, png_sha256,
                  anchors=anchors, hands=hands, tops=tops, clips=clips,
                  hand_fronts=hand_fronts, variants=variants, densities=densities,
                  pairs=pairs, interactions=interactions, bounds=bounds, surfaces=surfaces,
                  bed_catalog=bed_catalog, bed_layers=bed_layers, bed_coverage=bed_coverage,
                  pair_coverage=pair_coverage, pair_masks=pair_masks, dining_meals=dining_meals,
                  pages=pages, page_files=page_files, bed_trims=bed_trims,
                  seating_profiles={index: {profile['action']: profile} for index, profile in seating_data['profiles'].items()},
                  seating_layers=seating_data['layers'],
                  seating_coverage=seating_data['coverage'], seating_masks=seating_data['masks'],
                  shelf_profiles=shelf_data['profiles'], shelf_slots=shelf_data['slot_transforms'],
                  shelf_coverage=shelf_data['coverage'], shared_seat_layers={**reader_subset['layers'], **reading_actions['layers']},
                  shared_seat_preview=reader_subset['catalog'], shared_seat_catalog=reading_actions['catalog'],
                  joint_scene_alpha_ids={**reader_subset['joint_ids'], **reading_actions['joint_ids']}, reading_body_catalog=reading_actions['bodies'], dropped_book_sprites=dropped_books,
                  sofa_recline_catalog=reading_actions['recline'],
                  book_reach_catalog=reading_actions['reaches'], book_reach_shelves=reading_actions['reach_shelves'],
                  bathroom_profiles={index: {profile['action']: profile} for index, profile in bathroom_data['profiles'].items()},
                  bathroom_layers=bathroom_data['layers'], bathroom_coverage=bathroom_data['coverage'],
                  bathroom_masks=bathroom_data['masks'])

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
            path for path in revisioned_atlas_paths() if os.path.basename(path) not in page_files
        ]
        for path in stale_revisioned:
            bad.append(f"{path}: obsolete content-addressed atlas")
        for filename, payload in zip(page_files, pngs):
            path = Path(ATLAS_PNG).parent/filename
            if not path.is_file() or path.read_bytes() != payload:
                bad.append(f'{path}: page bytes differ')
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
        if os.path.basename(path) not in page_files:
            os.remove(path)
    for index, (filename, payload) in enumerate(zip(page_files, pngs)):
        alias_path = Path(ATLAS_PNG) if index == 0 else Path(ATLAS_PNG).with_name(f'atlas-page-{index}.png')
        alias_path.write_bytes(payload)
        (Path(ATLAS_PNG).parent/filename).write_bytes(payload)
    with open(ATLAS_PNG, "wb") as fh:
        fh.write(png)
    with open(
        os.path.join(os.path.dirname(ATLAS_PNG), revisioned_atlas_name(png_sha256)),
        "wb",
    ) as fh:
        fh.write(png)
    # Preserve the exact existing file bytes when generated text is unchanged.
    # Windows newline translation must not rewrite the frozen manifest prefix.
    for path, text in ((ATLAS_TOML, toml), (ATLAS_TS, ts)):
        if not os.path.exists(path) or Path(path).read_text() != text:
            Path(path).write_text(text, newline="\n")
    print(f"wrote {len(sprites)} sprites into {width}x{height} "
          f"({len(png) // 1024} KB)")
    for name, _, w, h in sprites:
        print(f"  {name:32s} {w:>4} x {h:>4}")


if __name__ == "__main__":
    main()
