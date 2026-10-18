# R6 review fix 1: aggregate room capacity

The review decoder now rejects final room areas whose sum exceeds the lot's cell count. This addresses the sole Important finding in the [initial fresh review](initial-review.md), against checkpoint `23bf404873b2e450658b8858d8a4395f2656686d`. It does not establish that native code emitted an invalid review, and no player impact was observed.

The production change is one aggregate `sum <= cells` check after the existing room relationship checks. It matches the summary decoder's capacity rule. Outside may have area zero, and the sum may be below capacity because wall cells need not belong to a room. No native API, wire layout, dependency, generated module, UI or builder code changed.

1. RED used the review's exact independent 1x1 packet. It declares Outside area 1 and enclosed room area 1, so the total is 2. The new assertion failed because `decodeBuildReview` returned without throwing. The other ten codec tests, including the new valid control, passed.
2. GREEN rejects that packet with `RoomWireError`. The complete codec file passes 11 tests.
3. A separate valid literal review has Outside area 0 and one enclosed room of area 1. It passes at 1x1, proving equality is valid, and at 2x1, proving spare capacity is valid. Replacing `<=` with `<` or `===` would fail one of these controls. Removing the guard fails the malformed-packet assertion.
4. The unchanged actual release module passes the existing eight-file boundary/storage/persistence suite with 250 tests. Type checking also passes. Tests use one worker with the existing 4096 MiB Node heap limit.

[Receipts](receipts.json) retain exact commands and exits, raw-log and normalized viewing-copy hashes, live before/after source fingerprints and unchanged module hashes. RED exits 1 as expected; GREEN, actual-module and type checks exit 0. Each command's source inputs remained unchanged during execution. The fixed broader source fingerprint is `8bea4105c0240ef1886dd2625d05eb920699ad83687458504cf994c58ff1cf25`. The two changed source-file hashes are recorded separately.

The module remains SHA256 `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`, with glue SHA256 `9c9504d64f536e175ca02ebd842e204fd518286f58b329ea0420a0fd1597508e`. No normal Wasm rebuild, native rerun, browser launch or bundling change was needed for this TypeScript-only fix. Prior build notices remain acknowledged; this fix does not claim warning-free output or a clean whole-web run.

Lesson: per-row bounds do not enforce a collection's shared capacity. Validate the aggregate relationship as well, and pair the malformed control with both equality and spare-capacity positive controls. This bounded report records the correction without changing documentation outside the assigned fix scope.

The parent's whole-web run 35589 was intentionally stopped incomplete after the builder failure. The isolated sale test has a null `lastSaleResult()` rather than the expected refusal receipt. Its broader diagnosis remains parent-owned and is not repaired or reclassified here. R7 integration, played visual acceptance and final broad gates remain separate.

**Next steps**: Parent performs a fresh scoped re-review of this fix. No user action is needed.
