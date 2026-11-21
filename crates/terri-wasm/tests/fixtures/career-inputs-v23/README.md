# Schema-23 saves from before the Career tab's score inputs

These two saves test the move to schema 24 for issues 311 and 317 ([CT-save-migrate] in [the Career tab plan](../../../../../docs/specs/2026-11-19-career-tab.md)): a schema-23 save has no place for the score inputs or a queued Go to work, so it loads with none, then saves as schema 24 and continues. `manifest.json` records each file's length and SHA-256.

They were written by the schema-23 projection (`Sim::save_snapshot_v23`) of branch `twcl/career-tab-311-317` at commit `eeb0842165da51f7d30b51b8f674e82bcb554614`, which merges main at `c7932801c`, not by main's own writer. The run sent no Go to work and no other player command, and the projection leaves out everything schema 24 adds, so the bytes are the schema-23 envelope of an ordinary run.

1. `new-game-thursday-noon.sav` is 7,769 bytes, SHA-256 `c0fcae1fd194cd15fca274afcc7216a79e6b6c5077135fd3fb029f32a9a59126`. It is the shipped household from `Sim::new_from_shipped_lot()`, saved after 5,040 ticks, Thursday noon of the first week, with three, one and one shifts scored this week and nothing reviewed.
2. `two-reviewed-weeks-tuesday-noon.sav` is 9,786 bytes, SHA-256 `00a7e0528e30865f1123f500540ba96edf0574d68aeaeb9f0b67b741ec6c8cd2`. It is the same run saved after 22,320 ticks, Tuesday noon of the third week, with weeks 0 and 1 reviewed for all three people.

The producer was a scratch example, not committed, that ran the native release build for the stated ticks and wrote the schema-23 projection with the schema-23 header.
