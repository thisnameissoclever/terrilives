"""Render the shipped SE lower-bunk layers with the current exported sleeper."""

import hashlib
from pathlib import Path
import sys
import tomllib

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "assets/sprites/gen"))

import objects  # noqa: E402
from iso import canvas, emit  # noqa: E402
from offline_sims import load_export  # noqa: E402


def prop_image(name):
    drawer = next(sprite for sprite in objects.SPRITES if sprite.__name__ == name)
    image, draw = canvas()
    drawer(draw)
    return emit(image, *objects.EXACT.get(name, (None, None)))[0]


def main():
    definitions = tomllib.loads((ROOT / "content/objects.toml").read_text(encoding="utf-8"))
    lot = tomllib.loads((ROOT / "content/lot.toml").read_text(encoding="utf-8"))
    bed = next(row for row in definitions["object"] if row["id"] == "bed")
    placement = next(row for row in lot["place"] if row["object"] == "bed")
    socket = next(row for row in bed["action_socket"] if row["id"] == "lower_bunk")
    assert placement.get("facing", "SE") == socket["facing"] == "SE"
    footprint = bed["footprint"]
    object_world = (placement["x"] + (footprint["width"] - 1) / 2,
                    placement["y"] + (footprint["depth"] - 1) / 2)
    socket_world = (object_world[0] + socket["x"], object_world[1] + socket["y"])
    socket_delta = (socket["x"] - socket["y"]) * 32, (socket["x"] + socket["y"]) * 21
    manifest = ROOT / "assets/models/sims/sim-01/export/manifest.json"
    export = load_export(manifest, required_clips={"sleep"})
    clip = export.clips["sleep"]
    bodies = {name: image for name, image, _, _ in export.sprites}
    background = prop_image(bed["sprite"])
    foreground = prop_image(bed["foreground_sprite"])
    count = clip["frame_count"]
    cell_width, cell_height = 176, 192
    board = Image.new("RGBA", (count * cell_width, 2 * cell_height), (237, 232, 221, 255))
    labels = ImageDraw.Draw(board)
    anchor_x, anchor_y = clip["anchor"]
    for row in range(2):
        for frame in range(count):
            # Render rows and sockets share the footprint centre. The shader
            # places a legacy sprite's bottom centre 21px below that position.
            origin_x = frame * cell_width + 107
            origin_y = row * cell_height + 157
            prop_position = (round(origin_x - background.width / 2),
                             origin_y + 21 - background.height)
            body_position = (round(origin_x + socket_delta[0] - anchor_x),
                             round(origin_y + socket_delta[1] + 21 - anchor_y))
            board.alpha_composite(background, prop_position)
            board.alpha_composite(bodies[f"rigSimSleepSE{frame}"], body_position)
            if row:
                board.alpha_composite(foreground,
                                      (round(origin_x - foreground.width / 2),
                                       origin_y + 21 - foreground.height))
            label = "Complete bed" if row else "Background + body"
            labels.text((frame * cell_width + 5, row * cell_height + 6),
                        f"{label} SE {frame}", fill=(35, 32, 27))
    output = Path(__file__).with_name("sleep-lower-bunk-contact.png")
    board.convert("RGB").resize((board.width * 3, board.height * 3),
                                Image.Resampling.NEAREST).save(output)
    print(f"Object world centre: {object_world}; lower_bunk socket: {socket_world} SE")
    print(f"Body dimensions: {clip['width']}x{clip['height']}; physical anchor: {clip['anchor']}")
    print(f"Manifest SHA-256: {hashlib.sha256(manifest.read_bytes()).hexdigest()}")
    print(f"Composite SHA-256: {hashlib.sha256(output.read_bytes()).hexdigest()}")
    print(f"Wrote: {output}")


if __name__ == "__main__":
    main()
