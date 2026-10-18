# Native integration advisory evidence

These dated records explain two integration decisions: command ownership while resolving the published V15 merge, and valid reading-scene construction for a current developer review tool. They are diagnostic reviews, not approval of the completed room feature or browser interface.

1. `merge-orchestration-better-way.md` records the independently inspected merge state and recommends explicit command/session/exit records. An earlier unknown process exit remains unknown; a conflict log does not prove its exit code.
2. `reading-tool-better-way.md` identifies a chair covering the bookshelf's sole authored pickup tile. Accepted read orders cannot start a reading activity while that tile is blocked. The report recommends clear access, a real enclosure and ordinary admission of the seated reader before the standing reader. Its proposed arrangement was not executed during the advisory review.
3. `rejected-reading-scene.rs` and `rejected-reading-support.rs` retain the failed scene inputs as evidence. They are not runnable examples or accepted gameplay implementations. The corresponding run log records two successful purchases, two accepted orders, books still on the shelf and no reading activity within 500 ticks.
4. `rejected-reading-receipt.json` records the actual failed exit. `rejected-reading-build-inputs.json` records the source hashes used for that run. `advisory-inputs.json` hashes the retained evidence files.

The raw review and source manifest retain their original task-owned scratch paths. The failed example and its shared support file are copied here under the names above. The full frozen Wasm source file named in that manifest is not duplicated here; its hash records what the reviewer inspected. Use the integration's Git history and the report's named function/source references for the surrounding implementation.

The successful scene repair, immutable integration checkpoint, fresh code review, full native gates, fault restoration and actual browser evidence require their own records. Do not infer those results from a proposed repair or from the failure log.

## Availability-query failure

`reading-scene-follow-up.md` retains the advisory report after the proposed arrangement failed its title-availability prerequisite. The scene passed its static geometry, paths, baseline load and two purchases, but the requested title was unavailable before another admission wait. `rejected-reading-alt1.rs`, `rejected-reading-alt1.log` and its receipt retain this attempted input and actual failure. No further scene variation followed that result.

The availability API enumerates new feasible plans; it does not describe a reader's existing activity. It can return no titles when the person carries a book or available copies are borrowed. Advancing one person also advances the other's autonomy. The actor-less failure log alone cannot establish which case occurred.

`reading-availability-observation.log` and its receipt retain a diagnostic run with unchanged scene inputs, commands and time limits. At tick zero, the chair reader can request the title. At tick 26, that reader is actually seated and reading copy zero. The other person has already autonomously reserved copy one for the intended bookshelf reading activity, reached Pickup, and received standing destination `(3,3)`. Both copies are therefore reserved and a query for new plans correctly returns no titles. The full snapshot and hash remain identical before and after the diagnostic observer.

The [contract review](reading-scene-contract-review.md) confirms that the tool must recognize that exact existing activity through its owner, origin, title, action, destination and copy ownership. It only needs a new-plan query when no activity is already admitted. An unexpected activity must fail the scene's preconditions. This corrects the query contract without another layout, timing, claim or loader change.

## Executed scene repair

`reading-native-goal.json`, its log and build-input manifest record the successful native run after that contract correction. B reaches actual seated Read at tick 26. A already owns the intended autonomous bookshelf activity and reaches standing Read at tick 34. The scene asserts distinct copies, exact owners/origins/actions/title, physical chair ownership, standing/seated state, the same enclosed room and configured proximity. The total admission wait is 34 ticks against the unchanged 500-tick bound.

The complete V16 save strictly reloads. Uninterrupted and reloaded simulations match for 120 further updates, including 60 observed updates with both people at Read. All five relationship-review variants then write valid current output. This result does not prove a positive Social refill from a meter already at its cap, and it is not a played browser or visual review.

The advisory input manifest records both original copied bytes and Git-stored bytes. Its `sha256` and `bytes` fields describe stored evidence; `raw_sha256` and `raw_bytes` describe the original copies. A normalization field identifies newline-only CRLF-to-LF conversion. The failed source files and saved games are not rewritten to fit a hash.
