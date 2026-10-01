# Packed instance count Task 1 report

Implementation is local to branch `twcx/packed-instance-count`. Source and production
output will be frozen after the local commit and final check record below. Root owns
browser acceptance, review, push and merge; none was performed by this worker.

## Scope and preflight

1. Assigned clean HEAD: `4603b2f0`; `git merge-base HEAD 6d2499d4` returned
   `6d2499d407d74f85d00929ac0bfde2bd4fe508dd`, exit 0.
2. `Get-FileHash web/src/wasm/terri_wasm_bg.wasm`, exit 0:
   `DA49265E97644CB5F3DCC2AEF11EF0406A0682F468145D0DF472640D929BF9DD`.
   This matches root's copied reviewed artifact. No Rust rebuild or dependency edits.
3. Read Task 1 brief and linked spec, project instructions, testing protocol,
   live-prefix, instance-stride and both preview lessons. Scanned docs and production,
   test and documentation references to both existing building/count APIs.
4. Changed files: `web/src/frame.ts`, `web/src/main.ts`,
   `web/tests/instance-batch.test.ts`, `web/tests/instance-batch-production.test.ts`,
   `web/tests/buy-tool.test.ts`, `web/tests/room-tool.test.ts`,
   `docs/ARCHITECTURE.md`, `docs/lessons-learned.md`.
5. Writing skills applied: my-writing-style, unslop and Natural Causes writing style.
   No player-facing strings changed.

## Implementation and self-review

1. Additive borrowed batch API reuses one result object and high-water array. Pointer
   publication occurs only on growth; count publication occurs on every frame.
   The final highlight writer advances the published slot. No trailing slots are
   inspected or cleared, and the 16-float layout and renderer interface are unchanged.
2. Legacy buildInstances retains all explicit parameters/defaults and forwards directly
   to the batch API without a new per-call object or array. instanceCount remains
   unchanged behaviorally for verification consumers.
3. Main's existing argument list is preserved, including floor highlight, actual tick,
   reduced motion, placement colourway and sky. Main consumes batch.instances/count;
   the legacy import and call are removed. Eliminated work is the duplicate world-column
   reads, interaction selection and entity traversal, not a measured timing/audio gain.
4. Tests assert independent counts and live rows for combined writers, portals,
   foreground suppression, absent fixed rows, selection, refused/nonoverlapping move
   previews, empty previews, exact held snack/dinner, growth/shrink/empty, legacy calls,
   stable result identity and real interaction updates. The production regression
   transpiles and executes verbatim main packing/draw statements with injected existing
   dependencies, rather than implementing a replacement frame loop. It also pins the
   real parameter list and absence of the old import/call.
5. Updated architecture/live-prefix contract and recorded the floor omission's cause,
   prevention and verification. Marked the overlap-only preview lesson superseded by
   L-furniture-preview-replacement; existing refused/nonoverlapping behavior is preserved.
6. Self-review found no production behavior changes beyond restoring the already-packed
   floor preview to the live draw prefix and eliminating the recount. Two test-authoring
   corrections were made: parked rows have sprite 0, not their old sprite; the typed
   draw spy avoids an unknown-array filter type error. These were not production defects
   and are not counted as regression or mutation evidence.

## RED and focused GREEN

1. Baseline command:
   `npm --prefix web test -- --maxWorkers=1 tests/frame.test.ts tests/interaction-frame.test.ts tests/portals.test.ts tests/placement-preview.test.ts`
   Exit 0, 4 files / 89 tests passed.
2. Before production edits, add real main-boundary regression and run:
   `npm --prefix web test -- --maxWorkers=1 tests/instance-batch-production.test.ts`
   Exit 1, 1 failed assertion: `AssertionError: expected +0 to be 2` at draw count.
   Existing main packed the floor highlight but counted only wall/room highlights.
   After production edits, the same command exited 0, 1 test passed.
3. Sequence disclosure: the additional batch-contract tests were added after the API
   implementation, then proved through behavioral mutations below. They are not claimed
   as pre-implementation RED. No missing-export/compilation failure is regression evidence.
4. Restored expanded focused command:
   `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts tests/instance-batch-production.test.ts tests/frame.test.ts tests/interaction-frame.test.ts tests/interaction-production.test.ts tests/portals.test.ts tests/placement-preview.test.ts`
   Exit 0, 7 files / 106 tests passed, duration 1.65s.

## Required behavioral mutation evidence

All mutations were applied to production code individually with apply_patch, run,
then reversed with apply_patch. Hash verification exited 0 after every restoration.
No compilation failures are counted. The later comment-only correction changes the
final frame.ts hash; the hashes below are exact bytes at mutation time.

### 1. final-highlight-slot

File: `web/src/frame.ts`. Change:

```diff
-  slot = writeTileHighlight(scratch, slot, highlight, originX, originY, gridSize, scale);
+  writeTileHighlight(scratch, slot, highlight, originX, originY, gridSize, scale);
```

Command: `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts tests/instance-batch-production.test.ts`.
Exit 1, CAUGHT by assertions:

```text
> test
> vitest run --maxWorkers=1 tests/instance-batch.test.ts tests/instance-batch-production.test.ts


 RUN  v4.1.10 D:/VIBES/.worktrees/packed-instance-count/terrilives/web

 ❯ tests/instance-batch-production.test.ts (1 test | 1 failed) 28ms
   × uploads the floor-tool highlight through the actual main packing and draw statements without recounting 27ms
 ❯ tests/instance-batch.test.ts (6 tests | 3 failed) 9ms
   × publishes exact combined writer rows including hidden fixed rows and the final highlight 5ms
   × packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter 1ms
   × publishes highlight-only, null and empty-highlight frames and exactly one held dinner 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/instance-batch-production.test.ts > uploads the floor-tool highlight through the actual main packing and draw statements without recounting
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/instance-batch-production.test.ts:36:17
     34|   expect(draw).toHaveBeenCalledTimes(1);
     35|   const [instances, count, scale] = draw.mock.calls[0];
     36|   expect(count).toBe(2);
       |                 ^
     37|   expect(scale).toBe(2);
     38|   expect(Array.from(instances.subarray(0, count * FLOATS_PER_INSTANCE)…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  tests/instance-batch.test.ts > publishes exact combined writer rows including hidden fixed rows and the final highlight
AssertionError: expected 12 to be 14 // Object.is equality

- Expected
+ Received

- 14
+ 12

 ❯ tests/instance-batch.test.ts:63:23
     61|   // 3 fixed + 2 portal + foreground + eating indicator + snack + sele…
     62|   // + 3 purchase preview + 2 highlight. The absent worker adds no ext…
     63|   expect(batch.count).toBe(14);
       |                       ^
     64|   expect(rows(batch.instances, batch.count)).toEqual([
     65|     simBodySprite(100, 2, 1, 37, true, 2, 2), box, 0,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  tests/instance-batch.test.ts > packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter
AssertionError: expected 3 to be 4 // Object.is equality

- Expected
+ Received

- 4
+ 3

 ❯ tests/instance-batch.test.ts:133:23
    131|     selection, null, highlight, 0, { width: 0, height: 0, values: new …
    132|   expect(legacy).toBe(batch.instances);
    133|   expect(batch.count).toBe(4);
       |                       ^
    134|   expect(rows(legacy, 4)).toEqual([bodyA, 0, ring, ring]);
    135|   expect(update).toHaveBeenCalledExactlyOnceWith(f.source, 8, true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  tests/instance-batch.test.ts > publishes highlight-only, null and empty-highlight frames and exactly one held dinner
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/instance-batch.test.ts:144:23
    142|   const batch = buildInstanceBatch(empty.source, 1, 100, 50, 16, null,…
    143|     null, undefined, null, highlight);
    144|   expect(batch.count).toBe(2);
       |                       ^
    145|   expect(rows(batch.instances, 2)).toEqual([ring, ring]);
    146|   expect(Array.from(batch.instances.subarray(0, 4))).toEqual([

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  2 failed (2)
      Tests  4 failed | 3 passed (7)
   Start at  06:50:07
   Duration  597ms (transform 177ms, setup 0ms, import 352ms, tests 37ms, environment 0ms)
```

Restored SHA-256: `E4B6017FD4738B4D14358505BD39E46A169A6988B2E3B862D413FE391FBA19A7`.

### 2. published-count

File: `web/src/frame.ts`. Change:

```diff
-  batch.count = slot;
+  // Mutation: omit count publication.
```

Command: `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts`.
Exit 1, CAUGHT by assertions:

```text
> test
> vitest run --maxWorkers=1 tests/instance-batch.test.ts


 RUN  v4.1.10 D:/VIBES/.worktrees/packed-instance-count/terrilives/web

 ❯ tests/instance-batch.test.ts (6 tests | 6 failed) 9ms
   × publishes exact combined writer rows including hidden fixed rows and the final highlight 6ms
   × refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result 1ms
   × replaces nonoverlapping moved furniture including refused=true, then restores selection on empty preview 0ms
   × replaces nonoverlapping moved furniture including refused=false, then restores selection on empty preview 0ms
   × packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter 1ms
   × publishes highlight-only, null and empty-highlight frames and exactly one held dinner 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/instance-batch.test.ts > publishes exact combined writer rows including hidden fixed rows and the final highlight
AssertionError: expected +0 to be 14 // Object.is equality

- Expected
+ Received

- 14
+ 0

 ❯ tests/instance-batch.test.ts:63:23
     61|   // 3 fixed + 2 portal + foreground + eating indicator + snack + sele…
     62|   // + 3 purchase preview + 2 highlight. The absent worker adds no ext…
     63|   expect(batch.count).toBe(14);
       |                       ^
     64|   expect(rows(batch.instances, batch.count)).toEqual([
     65|     simBodySprite(100, 2, 1, 37, true, 2, 2), box, 0,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/instance-batch.test.ts > refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result
AssertionError: expected +0 to be 21 // Object.is equality

- Expected
+ Received

- 21
+ 0

 ❯ tests/instance-batch.test.ts:81:23
     79|   expect(grown).toBe(first);
     80|   expect(grown.instances).not.toBe(oldArray);
     81|   expect(grown.count).toBe(large.source.count);
       |                       ^
     82|   expect(grown.instances.length).toBeGreaterThanOrEqual(grown.count * …
     83|   expect(grown.instances[(grown.count - 1) * FLOATS_PER_INSTANCE + OFF…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  tests/instance-batch.test.ts > replaces nonoverlapping moved furniture including refused=true, then restores selection on empty preview
 FAIL  tests/instance-batch.test.ts > replaces nonoverlapping moved furniture including refused=false, then restores selection on empty preview
AssertionError: expected +0 to be 4 // Object.is equality

- Expected
+ Received

- 4
+ 0

 ❯ tests/instance-batch.test.ts:102:23
    100|   const batch = buildInstanceBatch(f.source, 1, 0, 0, 16, 100, 1, fals…
    101|     null, undefined, preview);
    102|   expect(batch.count).toBe(4);
       |                       ^
    103|   expect(batch.instances[OFFSET_SCREEN_X]).toBe(-1e6);
    104|   expect(rows(batch.instances, 4)).toEqual([0, ring, box, foreground]);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  tests/instance-batch.test.ts > packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/instance-batch.test.ts:124:23
    122|   const update = vi.spyOn(selection, 'updateSource');
    123|   const batch = buildInstanceBatch(f.source, 1, 100, 50, 16, null, 2, …
    124|   expect(batch.count).toBe(2);
       |                       ^
    125|   expect(rows(batch.instances, 2)).toEqual([bodyB, 0]);
    126|   expect(batch.instances[FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBe(…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  tests/instance-batch.test.ts > publishes highlight-only, null and empty-highlight frames and exactly one held dinner
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/instance-batch.test.ts:144:23
    142|   const batch = buildInstanceBatch(empty.source, 1, 100, 50, 16, null,…
    143|     null, undefined, null, highlight);
    144|   expect(batch.count).toBe(2);
       |                       ^
    145|   expect(rows(batch.instances, 2)).toEqual([ring, ring]);
    146|   expect(Array.from(batch.instances.subarray(0, 4))).toEqual([

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯


 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  06:50:10
   Duration  265ms (transform 125ms, setup 0ms, import 149ms, tests 9ms, environment 0ms)
```

Restored SHA-256: `E4B6017FD4738B4D14358505BD39E46A169A6988B2E3B862D413FE391FBA19A7`.

### 3. grown-pointer

File: `web/src/frame.ts`. Change:

```diff
-    batch.instances = scratch;
+    // Mutation: omit grown pointer publication.
```

Command: `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts`.
Exit 1, CAUGHT by assertions:

```text
> test
> vitest run --maxWorkers=1 tests/instance-batch.test.ts


 RUN  v4.1.10 D:/VIBES/.worktrees/packed-instance-count/terrilives/web

 ❯ tests/instance-batch.test.ts (6 tests | 6 failed) 10ms
   × publishes exact combined writer rows including hidden fixed rows and the final highlight 7ms
   × refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result 1ms
   × replaces nonoverlapping moved furniture including refused=true, then restores selection on empty preview 1ms
   × replaces nonoverlapping moved furniture including refused=false, then restores selection on empty preview 0ms
   × packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter 1ms
   × publishes highlight-only, null and empty-highlight frames and exactly one held dinner 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/instance-batch.test.ts > publishes exact combined writer rows including hidden fixed rows and the final highlight
AssertionError: expected [ undefined, undefined, …(12) ] to deeply equal [ 436, 24, +0, 24, 12, 364, 43, …(7) ]

- Expected
+ Received

  [
-   436,
-   24,
-   0,
-   24,
-   12,
-   364,
-   43,
-   171,
-   12,
-   12,
-   24,
-   364,
-   12,
-   12,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
+   undefined,
  ]

 ❯ tests/instance-batch.test.ts:64:46
     62|   // + 3 purchase preview + 2 highlight. The absent worker adds no ext…
     63|   expect(batch.count).toBe(14);
     64|   expect(rows(batch.instances, batch.count)).toEqual([
       |                                              ^
     65|     simBodySprite(100, 2, 1, 37, true, 2, 2), box, 0,
     66|     box, ring, foreground, spriteIndex('indicatorEat'), spriteIndex('h…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/instance-batch.test.ts > refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result
AssertionError: expected Float32Array[] not to be Float32Array[] // Object.is equality
 ❯ tests/instance-batch.test.ts:80:31
     78|   const grown = buildInstanceBatch(large.source, 1, 0, 0, 16);
     79|   expect(grown).toBe(first);
     80|   expect(grown.instances).not.toBe(oldArray);
       |                               ^
     81|   expect(grown.count).toBe(large.source.count);
     82|   expect(grown.instances.length).toBeGreaterThanOrEqual(grown.count * …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  tests/instance-batch.test.ts > replaces nonoverlapping moved furniture including refused=true, then restores selection on empty preview
 FAIL  tests/instance-batch.test.ts > replaces nonoverlapping moved furniture including refused=false, then restores selection on empty preview
AssertionError: expected undefined to be -1000000 // Object.is equality

- Expected:
-1000000

+ Received:
undefined

 ❯ tests/instance-batch.test.ts:103:44
    101|     null, undefined, preview);
    102|   expect(batch.count).toBe(4);
    103|   expect(batch.instances[OFFSET_SCREEN_X]).toBe(-1e6);
       |                                            ^
    104|   expect(rows(batch.instances, 4)).toEqual([0, ring, box, foreground]);
    105|   buildInstanceBatch(f.source, 1, 0, 0, 16, 100, 1, false, 0,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  tests/instance-batch.test.ts > packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter
AssertionError: expected [ undefined, undefined ] to deeply equal [ 813, +0 ]

- Expected
+ Received

  [
-   813,
-   0,
+   undefined,
+   undefined,
  ]

 ❯ tests/instance-batch.test.ts:125:36
    123|   const batch = buildInstanceBatch(f.source, 1, 100, 50, 16, null, 2, …
    124|   expect(batch.count).toBe(2);
    125|   expect(rows(batch.instances, 2)).toEqual([bodyB, 0]);
       |                                    ^
    126|   expect(batch.instances[FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBe(…
    127|   expect(update).toHaveBeenCalledExactlyOnceWith(f.source, 8, false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  tests/instance-batch.test.ts > publishes highlight-only, null and empty-highlight frames and exactly one held dinner
AssertionError: expected [ undefined, undefined ] to deeply equal [ 12, 12 ]

- Expected
+ Received

  [
-   12,
-   12,
+   undefined,
+   undefined,
  ]

 ❯ tests/instance-batch.test.ts:145:36
    143|     null, undefined, null, highlight);
    144|   expect(batch.count).toBe(2);
    145|   expect(rows(batch.instances, 2)).toEqual([ring, ring]);
       |                                    ^
    146|   expect(Array.from(batch.instances.subarray(0, 4))).toEqual([
    147|     36, 260, expect.any(Number), ring,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯


 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  06:50:17
   Duration  293ms (transform 137ms, setup 0ms, import 163ms, tests 10ms, environment 0ms)
```

Restored SHA-256: `E4B6017FD4738B4D14358505BD39E46A169A6988B2E3B862D413FE391FBA19A7`.

### 4. stable-result

File: `web/src/frame.ts`. Change:

```diff
-  return batch;
+  return { instances: scratch, count: slot };
```

Command: `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts`.
Exit 1, CAUGHT by assertions:

```text
> test
> vitest run --maxWorkers=1 tests/instance-batch.test.ts


 RUN  v4.1.10 D:/VIBES/.worktrees/packed-instance-count/terrilives/web

 ❯ tests/instance-batch.test.ts (6 tests | 5 failed) 16ms
   × refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result 10ms
   × replaces nonoverlapping moved furniture including refused=true, then restores selection on empty preview 1ms
   × replaces nonoverlapping moved furniture including refused=false, then restores selection on empty preview 0ms
   × packs one paired interaction update with real tick and motion arguments and forwards every legacy parameter 1ms
   × publishes highlight-only, null and empty-highlight frames and exactly one held dinner 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/instance-batch.test.ts > refreshes count and pointer after growth, shrinking, empty frames and legacy calls without allocating a result
AssertionError: expected { …(2) } to be { …(2) } // Object.is equality


[Long array identity diff omitted; assertion location tests/instance-batch.test.ts:79.]

 Test Files  1 failed (1)
      Tests  5 failed | 1 passed (6)
```

Restored SHA-256: `E4B6017FD4738B4D14358505BD39E46A169A6988B2E3B862D413FE391FBA19A7`.

### 5. production-recount

File: `web/src/main.ts`. Change:

```diff
-      batch.count,
+      instanceCount(sim, selected, undefined, buyTool.ghost() ?? builder.preview,
        wallTool.highlight() ?? roomTool.highlight()),
```

Command: `npm --prefix web test -- --maxWorkers=1 tests/instance-batch-production.test.ts`.
Exit 1, CAUGHT by assertions:

```text
> test
> vitest run --maxWorkers=1 tests/instance-batch-production.test.ts


 RUN  v4.1.10 D:/VIBES/.worktrees/packed-instance-count/terrilives/web

 ❯ tests/instance-batch-production.test.ts (1 test | 1 failed) 30ms
   × uploads the floor-tool highlight through the actual main packing and draw statements without recounting 30ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/instance-batch-production.test.ts > uploads the floor-tool highlight through the actual main packing and draw statements without recounting
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/instance-batch-production.test.ts:36:17
     34|   expect(draw).toHaveBeenCalledTimes(1);
     35|   const [instances, count, scale] = draw.mock.calls[0];
     36|   expect(count).toBe(2);
       |                 ^
     37|   expect(scale).toBe(2);
     38|   expect(Array.from(instances.subarray(0, count * FLOATS_PER_INSTANCE)…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  06:50:21
   Duration  472ms (transform 184ms, setup 0ms, import 340ms, tests 30ms, environment 0ms)
```

Restored SHA-256: `B8C9E41A7DFF07BF9AC120B0477C53A4D85C0BEB76D916489C1AF8E49543FD19`.

## Final gates and freeze

1. First full suite: `npm --prefix web test -- --maxWorkers=1`, exit 1,
   114 files passed / 2 failed; 1719 tests passed / 2 failed, duration 20.99s.
   Both failures were stale source-wiring assertions preserving two argument lists:

   ```text
   FAIL tests/buy-tool.test.ts:794
   AssertionError: expected [ ...(2) ] to have a length of 3 but got 2
   FAIL tests/room-tool.test.ts:458
   AssertionError: expected [ ...(2) ] to have a length of 3 but got 2
   ```

   Updated the two expectations to one packing occurrence and corrected the Buy
   comment. Added that prevention rule to L-packed-instance-count.
   `npm --prefix web test -- --maxWorkers=1 tests/buy-tool.test.ts tests/room-tool.test.ts tests/instance-batch-production.test.ts`
   then exited 0: 3 files / 90 tests passed, duration 845ms.
2. Root released the heavy-check slot after priority door checks completed.
   `Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize`
   exited 0: 19672800 KB free / 66859092 KB total visible memory.
   Full suite rerun was required because the two test files changed; no passing full
   suite was redundantly rerun. Exact command:
   `$env:NODE_OPTIONS = '--max-old-space-size=1024'; npm --prefix web test -- --maxWorkers=1`
   Exit 0:

   ```text
   Test Files  116 passed (116)
   Tests       1721 passed (1721)
   Duration    20.89s
   ```

3. `npm --prefix web run typecheck`, exit 0: `tsc --noEmit`, no diagnostics.
4. `npm --prefix web run build`, exit 0:

   ```text
   vite v8.1.5 building client environment for production...
   86 modules transformed.
   dist/assets/save-worker-Cb-g-Su5.js          2.08 kB
   dist/index.html                            59.01 kB
   dist/assets/terri_wasm_bg-BwyH47uQ.wasm   2,075.72 kB
   dist/assets/index-BWCAliOW.css               6.89 kB
   dist/assets/index-oKDprcUJ.js              398.33 kB
   built in 125ms
   ```

5. `python check-doc-ids.py`, exit 0:
   `Documentation ids are unique and allocation-free.`
   `git diff --check` and `git diff --cached --check`, both exit 0, no output.
6. Unslop banned-phrase report scan exited 0 with zero violations. Structure scan
   exited 0 with no flags. Prohibited-dash searches found no authored matches.
7. Self-review included production diff, tests and wiring adjustments. Local commit:
   `616e4a8d519e3c51dc8366120db26c5fbcae7221`, message `Draw the exact packed instance count`.
   Explicitly staged only the eight owned files. `git status --short` after commit
   exited 0 with no output. No attribution trailers, push, PR or browser actions.
8. Final SHA-256 values:
   frame.ts: `902635E8CB3E6C98A32F310899968C73D29CE9DEEC069794B250B42EA983E6AE`.
   main.ts: `B8C9E41A7DFF07BF9AC120B0477C53A4D85C0BEB76D916489C1AF8E49543FD19`.
   reviewed WASM: `DA49265E97644CB5F3DCC2AEF11EF0406A0682F468145D0DF472640D929BF9DD`.
   built index-oKDprcUJ.js: `E0FCEEF4A311DB0A5E5E0118C5BA954E12D5C8D9FA021D57D4886C361B2FF5E5`.

Source and dist are frozen at this report. This build predates root's separate door
audio integration; root must account for that when refreshing the branch/build.
Browser/GPU acceptance: NOT RUN; root's gate.
Remote CI/mutation sweep, deployment and external delivery: NOT RUN.

## Played viewport follow-up

Root refreshed this branch with shipped door audio at e26bc71c, reviewed the renderer
and observed the floor highlight reaching the desktop/mobile GPU draws. Root then
assigned a played finding: switching desktop to a 390px viewport left floor keyboard
help visible. The initial floorControls.setCompact call existed, but floor controls
were absent from the shared compactHudQuery change listener.

1. Added exactly `floorControls?.setCompact(event.matches);` to that existing
   listener. No labels, CSS, control API or other behavior changed. Recorded cause,
   prevention and live transition verification in L-floor-help-viewport-transition.
2. `npm --prefix web test -- --maxWorkers=1 tests/floor-tool.test.ts tests/compact-hud.test.ts tests/builder.test.ts tests/instance-batch-production.test.ts`
   exited 0: 4 files / 60 tests passed, duration 1.88s.
3. `npm --prefix web run typecheck`, exit 0: `tsc --noEmit`, no diagnostics.
4. `npm --prefix web run build`, exit 0: 86 modules transformed, built in 1.18s;
   dynamic bundle `dist/assets/index-DpDiWA-m.js`, 398.20 kB / gzip 92.43 kB.
5. `python check-doc-ids.py`, exit 0: documentation IDs unique and allocation-free.
   `git diff --check` and `git diff --cached --check`, exit 0, no output.
6. Self-reviewed the two-file diff and committed only those owned files locally:
   `682f4cf830f98eeac1176ff10a934010dba3ebf0`,
   `Update floor-tool help when the viewport changes`.
7. Final main.ts SHA-256:
   `F0873BFDB5BCAB51BB37F7BB9B8CF2EF0CB3A438BE26754924115DA419B2C83F`.
   Built index-DpDiWA-m.js SHA-256:
   `77C827E628C4A858FB0227FC75D3743A696984758BE2861C953FDBC0D7ADD295`.
8. No full-suite rerun for this one-listener change, as directed. Native viewport
   transition proof remains with root; no browser or external delivery performed.
   Preserved root's dirty spec and untracked browser evidence/output. Worker source
   and rebuilt dist are frozen again after this report.

## Integration of shipped dock wellbeing changes

Root assigned integration after publication because main advanced to
`70f56b6ee1e96dff4f5182e8f678612bb3a2b0e8` with PR 189. Starting renderer HEAD
was `acf24307`. The worktree contained only root's untracked `web/output/`, which
was preserved. No root editing took place during this integration.

1. `git merge --no-edit origin/main`, exit 0, merged without conflicts using ort.
   Local integration commit: `e1f2da4e440358ec3e781c944637ccee064575cb`.
   Reviewed the upstream dock documentation, both added lessons, and merged main.
   Both branches' lesson/doc changes and renderer evidence remain present. Main
   retains buildInstanceBatch, batch.count and floorControls?.setCompact; it also
   retains the dock's activity-only summary and New housemate focus restoration.
   No Rust or dependency edits, manual conflict resolutions or additional source
   changes were needed.
2. `npm --prefix web test -- --maxWorkers=1 tests/instance-batch-production.test.ts tests/instance-batch.test.ts tests/floor-tool.test.ts tests/compact-hud.test.ts tests/traits-panel.test.ts`
   exited 0: 5 files / 76 tests passed, duration 2.34s.
3. `npm --prefix web run typecheck`, exit 0: `tsc --noEmit`, no diagnostics.
4. `npm --prefix web run build`, exit 0:

   ```text
   86 modules transformed.
   dist/assets/save-worker-Cb-g-Su5.js          2.08 kB
   dist/index.html                            58.62 kB
   dist/assets/terri_wasm_bg-BwyH47uQ.wasm   2,075.72 kB
   dist/assets/index-D5EfDF54.css               8.12 kB
   dist/assets/index-CvnfsN4A.js              398.17 kB / gzip 92.41 kB
   built in 1.65s
   ```

5. `python check-doc-ids.py`, exit 0:
   `Documentation ids are unique and allocation-free.`
   `git diff --check`, exit 0, no output.
6. Self-review of `git diff HEAD^1 HEAD -- web/src/main.ts` found only the two
   expected upstream additions: activity summary simplification and close-dialog
   focus restoration. Both renderer lessons and both upstream lessons exist under
   unique IDs. `git status --short`, exit 0, shows only preserved `?? web/output/`.
7. SHA-256 values at this integration freeze:
   frame.ts: `902635E8CB3E6C98A32F310899968C73D29CE9DEEC069794B250B42EA983E6AE`.
   main.ts: `FC3551B77DC8091C33BD29432853A87AE10AEB0186E3CAF217ACD251A383A45D`.
   reviewed WASM: `DA49265E97644CB5F3DCC2AEF11EF0406A0682F468145D0DF472640D929BF9DD`.
   index-CvnfsN4A.js: `AE06857EEC16D1C0DF84ABAB4A02F9A6B6956C7F8E4509E19438D6F020B885E8`.
8. No redundant full suite, browser checks, push or PR mutations were performed.
   Integration source/dist are frozen; root owns current combined browser proof
   and scoped integration review before updating PR 191.

## Integration of shipped activity bubbles

Root assigned a second distinct integration after main advanced to PR 190 at
`46e6b0a710ca0e2d9bd90ecedc3622e895df3af1`. Starting renderer HEAD was
`29f12e99`. Unlike the earlier dock integration, upstream changed actual activity
mapping, Rust/content and artwork, so the generated WASM package and full web suite
were refreshed as directed. No Rust rebuild, new Rust edits or dependencies changed.

1. Read the shipped activity-bubble spec and upstream lesson. Canonical eating code
   remains 3; its revised icon is the appended activityEat artwork. Walking and generic
   use now draw bubbles, exact authored activities extend the mapping through code 23,
   and only KIND_AGENT rows receive bubbles.
2. `git merge --no-edit origin/main`, exit 0, merged without conflicts using ort.
   Local merge commit: `002bd3450cbcb1577f184b6624134b89d5db5d0f`.
   Reviewed the merged frame diff: the current activity table and KIND_AGENT checks
   exist in both packing and legacy verification, while batch pointer/count
   publication, final highlight slot and explicit legacy wrapper remain intact.
   Floor viewport callback, dock changes and both branches' docs/evidence remain.
3. Verified the read-only source checkout D:/VIBES/.worktrees/233c/terrilives:
   `git -C D:/VIBES/.worktrees/233c/terrilives rev-parse HEAD` returned
   `46e6b0a710ca0e2d9bd90ecedc3622e895df3af1`; `git status --short` there returned
   no output before and after the copy. Source WASM hash matched root's required value.
   Used native Copy-Item with six explicit generated filenames into the existing
   destination web/src/wasm directory. Each source/destination SHA-256 matched:

   ```text
   .gitignore          684888C0EBB17F374298B65EE2807526C066094C701BCC7EBBE1C1095F494FC1
   package.json        5F2FE13416FB694EEE0DB5372C39CC345F22E871546AE120D9648F733B5184D9
   terri_wasm_bg.wasm  A7440EC0C4C486682F266923CF959BE7D1946BC3C6E73B230026A6FBB5F76E0F
   terri_wasm_bg.wasm.d.ts F7E97343D82E24EBD0985AFB0D591983592682FB9FBD84A589ABAFC89B7F1E07
   terri_wasm.d.ts      D41D2A49F3C53D7EF7653A3032FF906B7A106BCA1B205E594AE96A7DFAE4DBA9
   terri_wasm.js        3DE10C8A828CC63739203EAD80BF8134B12A29D0D67CC77A78C15D93286B536F
   ```

   Generated package files remain ignored artifacts, not new tracked source edits.
4. First focused command:
   `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts tests/instance-batch-production.test.ts tests/frame.test.ts tests/interaction-production.test.ts tests/portals.test.ts tests/placement-preview.test.ts`
   Exit 1, 5 files passed / 1 failed; 125 tests passed / 2 failed, duration 1.46s.
   Both failures were our stale old icon name, not count/packing regressions:

   ```text
   Combined rows: expected old indicatorEat sprite 43, received activityEat 1372.
   Held dinner: expected [436, 43, 47], received [436, 1372, 47].
   ```

   Changed only two expectations in web/tests/instance-batch.test.ts from
   spriteIndex('indicatorEat') to spriteIndex('activityEat'), as specified by the
   shipped content. Independent exact counts 14 and 3 and canonical activity 3
   remain unchanged; expectations do not read the packer's mapping.
   The same focused command then exited 0: 6 files / 127 tests passed, 1.51s.
5. Full web suite justified by the upstream activity/WASM changes:
   `$env:NODE_OPTIONS = '--max-old-space-size=1024'; npm --prefix web test -- --maxWorkers=1`
   Exit 0: 117 files / 1759 tests passed, duration 25.76s.
   Host-memory snapshot: 18881752 KB free / 66859092 KB total visible memory.
6. `npm --prefix web run typecheck`, exit 0: `tsc --noEmit`, no diagnostics.
   `npm --prefix web run build`, exit 0:

   ```text
   86 modules transformed.
   dist/index.html                            58.62 kB
   dist/assets/terri_wasm_bg-DhLxNY6n.wasm   2,078.25 kB / gzip 658.51 kB
   dist/assets/index-D5EfDF54.css               8.12 kB
   dist/assets/index-BQx-xRrq.js              400.31 kB / gzip 92.95 kB
   built in 124ms
   ```

7. `python check-doc-ids.py`, exit 0: IDs unique and allocation-free.
   `git diff --check` and `git diff --cached --check`, exit 0, no output.
   Self-reviewed the two-line test fix and merged production mapping.
   Local test integration commit: `a323b6e9f1c6fb81cccbe02187af5717d46622bf`,
   `Align packed-row expectations with shipped activity artwork`.
8. Final SHA-256 values:
   frame.ts: `ED3D7F63BAD0AF0B53826F5280DB604497A1F4549F1E17DBCE8F781CA647C74B`.
   main.ts: `FC3551B77DC8091C33BD29432853A87AE10AEB0186E3CAF217ACD251A383A45D`.
   WASM: `A7440EC0C4C486682F266923CF959BE7D1946BC3C6E73B230026A6FBB5F76E0F`.
   index-BQx-xRrq.js: `9A785EF0D706A1E5AB4BE3BD13F46F45221768399043EF807F34A4BCF8581CF3`.
9. No browser, push or PR changes. Preserved root's untracked integration-review
   report and web/output. Source/generated package/dist are frozen again.
   Root owns the final combined played proof and scoped integration review.

**Next steps**: Root plays and reviews the activity-bubble integration, then handles PR 191 delivery.
