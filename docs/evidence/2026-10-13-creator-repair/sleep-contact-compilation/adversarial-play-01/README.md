# Independent sleeping-preparation review

No actionable runtime or visual defect was found in the reviewed sleeping-preparation change. This review combined current source inspection with a fresh isolated Chrome run. It did not rerun the coordinating task's unit suite, 178-scene attachment comparison, or performance measurement.

## Current-source review

1. `character-preparation-service.ts` acquires independently keyed bike and sleeping resources and publishes a composite only when both are available. Replacing an owner preserves reused component leases before releasing the old composite. `preparation-queue.ts` has one active job, collects unowned queued and completed entries, and discards an obsolete in-flight result. The runtime roster and newest creator draft provide the bounded ownership policy.
2. `sleep-contact-identity.ts` preserves geometric appearance fields and normalizes only current uniform fields. Input revisions cover body and sleeping sources. The worker checks its source revisions, validates the request, and compiles the same prepared-body selection. `sleep-contact-protocol.ts` rejects sparse, incomplete, nonfinite, and non-Float32 arrays and wrong slot offsets. `sleep-contact-sample.ts` binds matrices to the selected parts, shape, source, bone count, and static one-sample contract. No synchronous sleeping fitter fallback or altered body range was found in the production sampling path.
3. `prepared-character-load.ts` inspects queued outcomes on a disposable candidate and adopts the original bytes only after `ContactStage.commit` validates all required owners. The roster pins queued results independently of a creator's lifetime and releases those pins after an actual native command drain. The reviewed cancellation and supersession paths do not drain commands on the live simulation.
4. `world.ts` retains cover topology by physical fixture identity, updates it from the current occupants' independent slot contributions, and releases it on fixture removal or world reset. `PreparedCharacter` borrows that resource and does not destroy it when an actor is replaced. Region 10 prevents a sleeper's slot offset from moving the whole cover; the scene supplies the fixture's identity token. CPU contact ownership remains outside graphics recovery.
5. `measurement.ts` records animation timestamp, callback entry, CPU end, and graphics completion separately. It retains callback delay and end-to-end latency alongside callback execution time, and waits for every submitted sample. The stale frame-timing comment in `main.ts` was reported to the coordinating task and corrected there.

## Fresh actual-game run

Command from the repository root:

```powershell
node --check .scratch/sleep-adversarial-review.cjs
node .scratch/sleep-adversarial-review.cjs
```

Both commands returned exit code 0. The browser used installed Chrome, a fresh 1600 by 1100 context, muted audio, the game at `http://127.0.0.1:5187`, and flat lighting. The script issued authoritative game orders and advanced bounded simulation ticks while waiting for actual sleeping-state predicates. It did not assign render poses directly.

1. All eight cases passed: the double bed and lower bunk, each facing 0, 1, 2, and 3. Fifty-two scene captures cover unused fixtures, order entry, a single sleeper, shared double-bed occupancy, the first occupant leaving, an empty fixture, and re-entry. The double-bed pair used a maximum-height/build feminine body and a maximum-height, minimum-build masculine body. Both retain the documented full ranges.
2. Every captured state within each case retained the same cover vertex-buffer identity. Neither input preparation nor compilation counters increased during entry, occupancy changes, exit, or re-entry. The ordinary empty fixture artwork returned after all occupants left. No JavaScript or graphics diagnostics were recorded.
3. While the person remained asleep in the lower bunk, the real creator controls changed the draft height from 100 to 0. The live save bytes remained identical. Deliberate loss of this task's graphics device advanced recovery generation from 0 to 1, preserved the visible height-0 draft, and left the complete CPU contact diagnostics unchanged. Cancelling retained the original height-100 sleeping person and the exact original save hash: `f2967f9084b4120594e33c0522a6800922672d69d2162ef82191c3875ffa8275`.
4. Cancellation released the draft's two resources: ownership returned from four composite owners and eight resource owners to three and six. No queued or in-flight work remained. The task-owned browser closed in `finally`; the shared server and owner browser were untouched. Hashes of the 12 reviewed production modules were unchanged during the run.

The machine-readable [report](report.json) contains every sampled scene, preparation counters, cover identities, source hashes, and cleanup result. Eight `*-unused.sav` files preserve the starting states. Screenshots are kept alongside them.

## Visual inspection and limits

The reviewer opened all eight active facing captures, three additional double-bed occupancy/exit views, matching unused/empty views for both fixture models, and both creator draft/recovery images. The covers followed the occupied places; the headboard, bed frame, bunk posts, ladder, and upper mattress retained their appearance and registration. No broken dark cover arcs, displaced fixture, new clipping, or lost sleeper was visible in those captures. The creator controls and recovered draft remained legible.

These observations cover the stated bodies, fixtures, facings, and transitions. They do not establish exhaustive continuous-parameter visual acceptance, performance on other graphics devices, or an owner art approval. Fixture removal and exact old/new numerical geometry were inspected in source and existing focused tests; this reviewer did not execute those tests. The coordinating task owns the broader numerical, attachment-parity, and frame-budget evidence.

**Next steps**: No repair is requested from this review. The coordinating task can include this evidence in the local delivery report.
