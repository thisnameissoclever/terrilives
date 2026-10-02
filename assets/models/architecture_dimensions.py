"""Shared authored wall and fixed door casing depth, in game units."""
import json
from pathlib import Path

CONFIG = Path(__file__).with_name('architecture-depth.json')
_data = json.loads(CONFIG.read_text())
assert _data['schema'] == 1
WALL_AND_DOOR_DEPTH = _data['wallAndDoorDepth']
assert type(WALL_AND_DOOR_DEPTH) in (int, float) and 0 < WALL_AND_DOOR_DEPTH < .5
