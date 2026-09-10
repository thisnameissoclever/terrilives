"""Composite actual runtime food sprites at exported native grip coordinates."""

from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "assets/sprites/gen"))
import build
from offline_sims import FACINGS, load_export


def main():
    export = load_export(ROOT / "assets/models/sims/sim-01/export/manifest.json", required_clips={"eat"})
    props = {name: image for name, image, _, _ in build.render_all()}
    frames = {name: image for name, image, _, _ in export.sprites}
    count = export.clips["eat"]["frame_count"]
    cell_w, cell_h = 94, 122
    board = Image.new("RGBA", (cell_w * count * 2, cell_h * 4), (237, 232, 221, 255))
    labels = ImageDraw.Draw(board)
    for row, facing in enumerate(FACINGS):
        for meal, prop_name in enumerate(("heldSnack", "carried_dinner")):
            prop = props[prop_name]
            for sample in range(count):
                column = meal * count + sample
                name = f"rigSimEat{facing}{sample}"
                body = frames[name]
                left, top = column * cell_w + (cell_w - body.width) // 2, row * cell_h + 14
                hand = export.frames[name]["hand_anchor"]
                in_front = export.frames[name]["hand_in_front"]
                if in_front:
                    board.alpha_composite(body, (left, top))
                board.alpha_composite(prop, (round(left + hand[0] - prop.width / 2),
                                             round(top + hand[1] - prop.height / 2)))
                if not in_front:
                    board.alpha_composite(body, (left, top))
                labels.text((column * cell_w + 3, row * cell_h + 2),
                            f"{facing} {sample} {'snack' if meal == 0 else 'dinner'}", fill=(35, 32, 27))
    output = Path(__file__).with_name("food-hand-contact.png")
    board.convert("RGB").resize((board.width * 3, board.height * 3), Image.Resampling.NEAREST).save(output)
    print(output)


if __name__ == "__main__":
    main()
