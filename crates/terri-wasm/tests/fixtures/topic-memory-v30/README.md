# Schema-30 saves from before remembered topic preferences

These two saves were written by main at commit `6fc824780`, whose current save is schema 30. They test the move to schema 31 in issue 359 with bytes this branch's writer did not produce: a schema-30 save has no place for remembered topic preferences, so it loads with nothing remembered, then saves as schema 31 and continues.

1. `new-game-two-days-evening.sav` is 7,990 bytes, SHA-256 `6241339fa31a1ebbf632f54761c26edc92a2545599e6875ff5a5be02b7c1e99f`. It is the shipped household from `SimHandle::from_lot()`, saved after 3,960 ticks, Wednesday at 18:00.
2. `new-game-sunday-evening.sav` is 9,633 bytes, SHA-256 `5528f0d74935a7063f9cb2d8c817b9b818a5c42af847b8c6a8a6d9d5fe988bb0`. It is the same household saved after 9,720 ticks, Sunday at 18:00, the end of the first week.

The producer was a scratch native example, not committed, built in release from that commit's unchanged tree. It ran `SimHandle::from_lot()` for the stated ticks and wrote `save_bytes()` after checking that the header's schema is 30.
