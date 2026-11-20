# Schema-22 saves from before the fading lift of liked furniture

These two saves were written by main at commit `54cf96b46a4d5c152f4b0f7cd8263698fdfae6d1`, whose current save is schema 22. They test the move to schema 23 in issue 344 ([OA-presence] in [the object affinities spec](../../../../../docs/specs/2026-10-06-object-affinities.md)) with bytes this branch's writer did not produce: a schema-22 save has no place for a lift that is still fading, so it loads with none, then saves as schema 23 and continues. `manifest.json` records each file's length and SHA-256.

1. `new-game-day-one-noon.sav` is 6,168 bytes, SHA-256 `e9821911a02fcf3d199c8e5c08e9f92192452f15b2f3c6ed8b7d623562355095`. It is the shipped household from `SimHandle::from_lot()`, saved after 720 ticks, noon of the first day.
2. `new-game-two-days-evening.sav` is 7,213 bytes, SHA-256 `56453a6147b51bd2daeecab7304dfdd568a501d31007c7cd1aa5efde300ba04b`. It is the same household saved after 3,960 ticks, Wednesday at 18:00.

The producer was a scratch Node script, not committed, that loaded the release WASM built from the source revision's tree, ran `SimHandle.from_lot()` for the stated ticks, and wrote `save_bytes()` after checking that the header's schema is 22.
