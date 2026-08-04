"""One palette, four hours. If the light rig is a system, night is a
setting rather than a second art style."""
import art2, os
from art2 import STYLES, Light, RIG, KEY, scene, OUT

muted = [s for s in STYLES if s.key == "muted"][0]
HOURS = {
 "07h": ([], [(5.0, 0.1, 8.7, 2.0)], (30, 34, 40), (232, 238, 246)),
 "13h": ([], [(5.0, 0.2, 8.6, 1.3)], (22, 22, 22), None),
 "19h": ([Light(1.1, 4.6, 3.0, (255, 214, 150), .20)],
         [(5.0, 0.1, 8.7, 2.4), (0.2, 4.4, 3.2, 6.6)], (78, 50, 18), (255, 226, 194)),
 # The pool is added before the hour's multiply, so at night the multiply
 # dims the very thing that should dominate. Compensate in the rig rather
 # than reordering: a lamp reads by CONTRAST with its room, not by absolute value.
 "23h": ([Light(1.1, 4.6, 3.6, (255, 186, 104), .95),
          Light(3.8, 5.9, 2.4, (126, 196, 236), .58),
          Light(6.9, 1.2, 2.2, (255, 196, 130), .34)],
         [], (0, 0, 0), (118, 124, 156)),
}
orig_key, orig_shadow = KEY["muted"], muted.shadow
SHADOW = {"07h": .16, "13h": .30, "19h": .34, "23h": .30}
KEYS =   {"07h": (.30, .24), "13h": (.12, .12), "19h": (.44, .34), "23h": (.20, .18)}
for h, rig in HOURS.items():
    RIG["muted"] = rig
    KEY["muted"] = KEYS[h]
    muted.shadow = SHADOW[h]
    im = scene(muted)
    im.save(f"{OUT}/cycle-{h}.png", optimize=True)
    print(h, os.path.getsize(f"{OUT}/cycle-{h}.png")//1024, "KB")
