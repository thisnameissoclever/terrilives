# Boundary acceptance and furniture-sale diagnosis

This record follows code checkpoint `5428eea6c503ee9a6c46a82e19100bbff7d21cd0`. The scoped area re-review accepts the R6 decoder repair. It does not approve the unimplemented R7 interface or final branch gates.

The whole-web run was intentionally interrupted after 419.806 seconds without an aggregate result. Only its first reported builder-sale failure is known. Its source inputs stayed unchanged. The later isolated case completed normally and failed because the sale result was null. The quiet full-run cause remains unclassified; a later complete run needs per-file progress, without exclusions or longer test deadlines.

The read-only native diagnosis identifies the original fixture's invalid precondition: object 15 is a floor lamp with no interactions. The actual release-module probe confirms empty sale results before and after the browser refresh and native error `[1,0,1,10,1,6]`, meaning Validation / InvalidContentReference. Queue acceptance did not establish an executable action.

The same joined queue with interactive object 22 produces `[22,8,0]` before and after the browser refresh, meaning an InUse refusal with no payout. Its native error response is `[1,0,0]`, meaning no error. Both cases strictly load and resave complete V16 bytes. No simulation tick or native Build Begin occurs in this diagnostic.

The valid-input control also exposes a separate UI defect: `saleRefusal` retains the refusal explanation while `status` becomes Ready to place. The original status-asserting probe fails and is retained as `sale-status-red-probe.mjs` and its red log. The later native-control probe records that mismatch as data; its exit-zero result proves the native observations and save admission, not correct UI status. R7 must repair the action-feedback order and retain the valid-input status assertion before delivery. No native admission change is justified by this evidence.

Module SHA256 is `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`; broader executable-input fingerprint is `8bea4105c0240ef1886dd2625d05eb920699ad83687458504cf994c58ff1cf25`. Receipts retain commands, exits and unchanged source/artifact inputs. `retained-files.json` separates raw-log hashes from normalized UTF-8 Git viewing copies.

To reproduce a probe, copy its retained script into ignored `.local-build/` and run Node from the repository root. The script uses the existing Vite server-side module loader, the real generated module and production bridge/Builder classes. It closes its own middleware server and frees handles in finally. It changes no live user save, native memory or production source.

This commit retains internal review and diagnosis only. It changes no player behavior and needs no separate public changelog entry. The completed room feature and its verified interface fixes receive player notes at delivery.
