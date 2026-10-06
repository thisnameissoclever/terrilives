# Resume fitted interaction animations

This is the cross-machine handoff requested on 2026-10-06. Finish the remaining animations, validate the delivered batches, merge them into main and verify the public game. The checkpoint preserves unfinished work; it is not a passing build or a release. Read this document first, then load the task-specific evidence below. No previous chat or local Git stash is required.

## Repository and exact starting state

1. Repository: `https://github.com/thisnameissoclever/terrilives.git`.
2. Resume branch: `twcx/bathroom-action-poses`. Fetch that remote branch and check it out explicitly. Do not start from main and assume the checkpoint is present.
3. Implementation base: `1a138df6438d5e984f6190956b46aaf9a69f4dc9`, the merged seated-media release. Find the checkpoint commit with `git log -1 --format=fuller -- docs/handoffs/2026-10-06-animation-resume.md`; the document cannot contain the hash of the commit that first contains itself.
4. Last fetched main on 2026-10-06: `d19c2d6e10487145813e7a1ae1469cc42dd730b9`. Main has newer skills, calendar, affinities, editing and autonomous-cleanup changes. It touches `content/objects.toml`, data compilation/packing, simulation and save code, and shared documentation. These changes have not been integrated into the checkpoint. Fetch again before integrating; preserve them and use a normal merge, not rebase or force push.
5. Previous machine's assigned worktree was `D:/VIBES/.worktrees/terrilives/bike-chair-four-facings`. Its canonical checkout `D:/VIBES/terrilives` was left untouched. On another machine, use a dedicated checkout of this same repository. Treat its chosen root as the workspace root; the old absolute drive paths are provenance, not required destinations.

For a new checkout, use the following commands from the parent directory. An existing checkout should fetch and switch only after checking its dirty state.

```text
git clone --branch twcx/bathroom-action-poses --single-branch https://github.com/thisnameissoclever/terrilives.git terrilives-animation-resume
cd terrilives-animation-resume
git fetch origin main:refs/remotes/origin/main
python docs/handoffs/animation-resume/verify-transfer.py
```

The transfer verifier checks the checkpoint file inventory and available original or frozen snapshot bytes for source receipt dependencies. It does not certify animation geometry, export acceptance or deployment. Preserve exact file bytes; `.gitattributes` protects the new hash-bound producers and receipts from newline conversion. Fetch the full history if a later comparison needs older merged revisions absent from a shallow clone.

The earliest rejected toilet prototypes 01 and 02 lack five producer-to-receipt bindings, representing four unique old producer versions. Those bytes were already absent on the former machine; they were overwritten before complete source snapshots existed. Their rejected journals are preserved, but exact regeneration is not claimed. `animation-resume/historical-gaps.json` names each exact missing binding. The transfer verifier reports only those documented historical gaps and rejects every undeclared missing dependency. Accepted prototype 08, the active loop/ink sources, deferred code and current task modules are fully retained; no active dependency is excused by that historical list.

## Requested scope and ownership

The owner requested more aquarium fish idle motion and missing animations for taking a bath, showering, using the toilet, sitting, watching television and listening to the radio, plus an audit for other missing interaction animations. Television and radio should use seating rather than standing whenever an eligible seat exists. The agreed rule is a seven-tile Euclidean radius within a 90-degree cone in the device's physical front.

The owner authorized autonomous implementation, independent adversarial code and visual review, normal commits/pushes/merges and live publication. Routine permission to continue is unnecessary. This particular checkpoint is intentionally pushed only to the feature branch for transfer; its known failures must be resolved before merging or deploying it. The next agent becomes the implementation owner when the owner starts the new task with this handoff. No replacement task was created or assigned automatically.

1. Preserve approved Sim appearance, hair, seventeen anatomical bone lengths, recolourable shirts and the existing offline 3D-to-2D sprite pipeline. The runtime remains sprite-based, not a live 3D renderer.
2. Preserve furniture IDs, playable footprints, saved household state and every published decoded sprite and metadata record. Do not shrink furniture or alter the standing rig to conceal a bad pose.
3. Keep source acceptance, rendered composition, browser graphics, picking, gameplay lifecycle and public deployment as separate gates.
4. Use no paid generation requests or new dependencies. Provider credentials are not required and are not included. Install the repository's existing locked toolchain on a fresh machine; ask before changing dependency versions.
5. Follow `AGENTS.md`, `docs/lessons-learned.md`, `docs/testing-protocol.md` and the project writing/changelog skills. Read `docs/specs/2026-10-05-interaction-animation-expansion.md` and `docs/superpowers/plans/2026-10-05-bathroom-action-poses.md` before editing implementation.
6. After three materially similar failures, obtain fresh-context `better-way` review before another variation. The former chat could not launch that reviewer because it reached its agent-thread limit. That limit is a former-chat observation, not proof that the new task is also blocked.
7. Use only dedicated task-owned browser contexts. Close them in a finally block and stop only owned preview servers. Do not take over the user's desktop or leave an audible game running.
8. Serialize heavy background Blender jobs, use two threads and check free memory first. Previous jobs required at least 4 GiB free. Do not stop another task's processes. On Windows use a hidden launcher; its detached exit code alone does not establish that Blender completed. Require a completed proof journal and an exited owned writer.

## What has already reached main

| Request | State and proof | Remaining obligation |
| --- | --- | --- |
| Fish idle/swimming motion | PR212 merged as `e56028e573be2a7bdfa7269b9ea2a2ee1cb7e7dd`. Eight samples in four facings, three independently phased fish and tail articulation. Historical exact main CI run `37323174998` and Pages run `37324578673` succeeded; public atlas bytes and actual played motion were inspected. | Preserve it. Recheck regressions after bathroom integration; do not recreate the completed batch. |
| Watching TV and listening to radio | PR213 merged as `1a138df6438d5e984f6190956b46aaf9a69f4dc9`. Eligible reachable, unclaimed seats in the seven-tile/90-degree front cone; facing and no-wall checks; standing fallback; separate device and chair ownership; deterministic save restoration and cancellation. Historical CI `37356417134` and Pages `37358194395` succeeded. Public Tim-to-TV use was visibly seated. | Preserve it and the exact media target. Do not replace the device interaction with a chair interaction. |
| Ordinary sitting | PR213 also added ottoman sitting and fitted neutral viewing/listening poses on dining, desk and reading chairs, armchairs, sofas and ottomans. Existing reading/eating actions remain intact. | Audit other explicit ordinary Sit actions. Sofa Lie down is not completed by this upright sitting batch. Do not claim every seat/action is finished. |
| Toilet | Source pose and quiet loop accepted; native and browser wiring partly implemented on this branch. Nothing from this bathroom checkpoint is merged or deployed. | Resolve the contact validator, regenerate export/atlas, finish browser and graphics proof, then publish. |
| Bath | No accepted source pose, animation, runtime export or publication. | Resume the geometry-derived wall-backed source approach, then all delivery gates. |
| Shower | Mechanically passing coverage exists, but its visual shape was rejected. Native edits were deferred. No accepted loop/export/runtime release. | Obtain a different visual approach, accept the source, reconcile deferred code and finish all delivery gates. |
| Other missing animations | No exhaustive final audit completed. | Inspect object interactions and actual render selection. Name uncovered actions and implement reasonable in-scope omissions without inventing unrelated gameplay. |

The historical live asset receipts and screenshots are under `animation-resume/evidence/`. `media-public-assets.json` records all 22 pages of that release; `aquarium-swim-public.json` records the earlier fish release. These are dated historical results, not a claim that today's public bundle has the same entrypoint. The public game is `https://thisnameissoclever.github.io/terrilives/`.

## Start with the toilet blocker

Run this deliberate failing regression before changing the contact validator:

```text
python docs/handoffs/animation-resume/reproduce-contact-blocker.py
```

Observed at handoff: exit 1, `AssertionError: ValueError not raised`. The current validator accepts a polygon that winds twice around half of a contact cell. A second circuit shifted by `1e-10` metres makes all vertices distinct while keeping edge violations below the `1e-12` square-metre arithmetic tolerance. The false area is approximately twice the real union area. The accepted source art is not defective; corrupted and re-signed evidence can pass its importer.

1. Give a fresh-context `better-way` reviewer the reproducer, `assets/models/bathroom/actions/bathroom_export_contract.py`, frozen `contact_surface.py`, actual source receipts and these constraints.
2. Reconsider polygon simplicity and ordered convex boundaries, or compute actual union area. Do not add another small tolerance variation to the same design. Exact predicates for supplied float values are a possible direction, not an approved implementation.
3. Preserve the frozen producer and accepted source. Fix action-local import validation in a new or safely versioned dependency. Keep existing physical gap, area and span limits unchanged.
4. Prove authentic source acceptance and rejection of missing matrices, negative measurements, overlapping half cells, exact double winding, near-double winding, false closure targets, altered palette colours and false retained reconstruction images.
5. Re-export from the unchanged accepted source into a new directory, such as `export/toilet-04`. Do not rewrite an old manifest to manufacture a valid dependency hash.

### Accepted toilet sources and current implementation

1. `assets/models/bathroom/actions/review/toilet/prototype-08-curved-support/` contains the accepted centred seated pose, editable model, four green beauty views, measured mirrored curved support and source snapshots. Primary and independent visual review accepted it; previous prototypes remain rejected evidence.
2. `review/toilet/loop-01/proof.json` SHA256 is `a16299c576d6eed2d1b30bfb3b80b6b0df53f6eaa0765a62dc72d556cacb6ed7`. The loop model hash is `7e3003a9a9c32cb9b308c84642bd5d22b3e1cb71058e1b6fd22243ce67c20829`.
3. `review/toilet/ink-01/proof.json` SHA256 is `780238f3d7e6b351bb76d21a08631b45050ab816f160fed0f0236fe6e7a0751b`.
4. The quiet closed loop has four samples and sixteen simulation ticks. Hand lifts are 0/4/8/4 mm; feet stay fixed. It contains all three shirt colours, four facings and original `768x960` RGBA passes. The source batch retains 192 raw images and 16 body-owned ink passes. Closure, save/reopen, complete collision and palette checks passed before export integration.
5. Latest retained export is `assets/models/bathroom/actions/export/toilet-03/manifest.json`, canonical JSON SHA256 `73b7d178dda60eaec4899d38d668b574c2dc3a2cd9e9eeea288b298360213fa0`. It is superseded because its validator dependency changed afterward. The current atlas build correctly rejects that mismatch. Earlier `toilet-01` and `toilet-02` are historical, not replacements to import.
6. This export would add 108 records: 60 visible-contribution textures and 48 scene aliases. Its source reconstruction observed maximum colour error four and 95th-percentile error two against independent floating-point beauty; limits stayed six/two. This is not a full browser graphics result.
7. Root-owned runtime edits are in `content/objects.toml`, `crates/terri-data/src/{compile,lib,pack}.rs`, `crates/terri-sim/src/{lib,render_buffer,activity_tests}.rs`, `render_buffer/toilet_projection_tests.rs`, `web/src/{frame,input}.ts` and `web/src/render/sprites.ts`.
8. `CompiledVisualAction::UseToilet` currently appends at ordinal 10. Renderer action `USE_TOILET` is 15; 14 is reserved for the deferred shower. The toilet seat socket is presentation-only, at local 0,0. Do not change its 24-tick gameplay duration, privacy, flush sound, needs, paths or save fingerprint.
9. Export/import/build files are `bathroom_export_contract.py`, `export_toilet_loop.py`, `assets/sprites/gen/offline_bathroom.py`, `build.py`, `offline_architecture.py` and `assets/models/architecture/architecture.json`. They add independent `BATHROOM_SPRITES`, `BATHROOM_LAYERS`, `BATHROOM_COVERAGE` and `BATHROOM_MASKS`, preserving older tables.
10. Web code imports those tables, but the generated atlas has not been rebuilt successfully. Web typecheck and production tests therefore cannot be reported as passing. `web/tests/toilet-production.test.ts` contains all-facing/palette sampling and click-owner cases plus compiled use/Load/cancellation checks; only its initial missing-table failure was observed.

For diagnosis and source reasoning, read `animation-resume/evidence/toilet-deformation-findings.md` and `toilet-loop-source-report.md`. Historical source reports may describe older rejection states; current acceptance comes from the specific receipts above. Do not rerender the accepted loop solely because exporter checks changed.

## Resume bathing

Read `animation-resume/evidence/bath-source-report.md` before running a new source job. `assets/models/bathroom/actions/` retains all bath modules, pure tests and three complete diagnostic directories.

1. The nine-frame floor-recline family had torso/floor collisions despite supported hips. Case-zero diagnosis retained all 121 crossing triangle pairs and showed the lower torso follows the spine below its waist.
2. One frozen bath-only binding experiment improved height but retained approximately 3.49 mm floor penetration, unsupported upper back and approximately 10.72 mm extra placket detachment. The seam limit remained 2 mm. This is a rejected causal experiment; do not tune that field further.
3. The next authorized approach uses the original rig against the actual inner negative-Y head-end wall. Derive its evaluated wall normals and domains. Solve coherent pelvis/back frames and a translation satisfying actual hip and finite upper-back support. Head points away from the positive-Y taps. The nominal 17-degree wall inference is not a certified plane or selected pose.
4. A steep wall requires wall-tangent finite support and normal-directed surface queries. The old vertical floor grid cannot certify wall contact. Keep the neutral upper-back label interval `[1.12,1.31]` and complete 54-body clearance checks.
5. `test_bath_wall_support.py` is intentionally red because `bath_wall_support.py` does not exist. Implement it test-first. After upper-body support passes, fit limbs and below-rim water, obtain source review, bake the loop, render all colours/facings and proceed through export/runtime/browser/publication gates.
6. The original tub is `bathroom/owner-review-pending/bathtub/candidate-02/bathtub-authoring.blend`, hash `4eb71e029fd7904cffa612fbec122831b86911f24643ff92099c8c731fc25f56`. The current runtime tub already has the SW facing and 1x2 footprint. Do not repeat the earlier quarter-turn migration.

## Resume showering and deferred native code

Read `animation-resume/evidence/shower-source-report.md` and `shower-native-gates.md`. Prototypes 01 through 10, frozen source snapshots, rejected images and editable outputs are preserved under `assets/models/bathroom/actions/review/shower/`.

1. Mechanically accepted protected-core coverage encloses all lower-clothing vertices and triangles and passes all four views. The shape still looked like padded clothes, then a sack or blanket. Removing outlines and using constant-emission shading did not solve that silhouette. This visual design is rejected, not permission to ship because the coverage math passes.
2. Use fresh design review to choose a materially different shower presentation. Keep privacy coverage, full fixture and body checks, unchanged head/hair and recognizable water/steam. Do not repeat small cloud or shader changes on the rejected design.
3. The shader effect is not simulated fluid and must not become a structural support or collision solid. The earlier bath/shower work never authorized explicit anatomy.
4. The original shower model hash is `c57a911a5e3964e4d23278e1a48150e2fcf3e940ad91183b9480db8a78e60865`. The shared original rig hash is `919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce`.
5. Tested deferred native shower changes were in stash `fa65db11465a2a1ef2e98bf9a43ef85f79fc4dc3`. Stashes do not travel with a clone. The exact tracked and untracked patches are now in `animation-resume/deferred-shower/`; the stash identifier is only provenance.
6. Inspect both patches before applying them after shower source acceptance. Use `git apply --check` and reconcile conflicts manually. They were based before toilet changes; blindly applying them could remove `UseToilet`. Shower compiled ordinal 10 from the old patch must be appended after the currently preserved toilet ordinal, and the golden packed bytes must be corrected. Renderer shower code 14 and toilet code 15 remain distinct.
7. Native acceptance from the old patch does not establish accepted art, export, graphics, picking or deployment. Complete all of those after the new source is accepted.

## Other actions and earlier work

Audit actual `content/objects.toml` interactions and selected render profiles instead of treating activity names as proof of animation. Cover ordinary sitting wherever requested. Check sofa Lie down separately from upright TV/radio seating. Check dining-table Sit down to eat separately from generic sitting; preserve the existing meal and hand/dish support pipeline. Then check any other visibly standing or incorrect interaction in the same animation scope and record explicit dispositions.

Earlier layout, wall visibility, bathtub rotation, near-side bunk ladder, covered sleeping and closer zoom work predates this bathroom checkpoint. Do not redo it based on old chat screenshots. Use the current main code and dated evidence, including `docs/superpowers/plans/2026-09-20-bathtub-quarter-turn.md`, `docs/assets/review-evidence/bedroom/`, and the earlier task records. Additional unique hairstyle concepts and a Sim creator style expansion were future owner-led work, not a task to invent now. Finish the explicit animation list before expanding beyond it.

### All owned stashes are portable

`animation-resume/owned-stashes.bundle` preserves all seven identified stashes from this conversation, including their index and untracked-file parent commits when present. `owned-stashes.json` records each exact commit, base, subject and changed/untracked paths. The bundle was verified with Git; it is approximately 14.5 MB because already-published history is excluded. It requires the original base commits, which are reachable from this checkpoint's normal full history. A shallow clone may need an unshallow fetch before verifying the bundle.

```text
git bundle verify docs/handoffs/animation-resume/owned-stashes.bundle
git fetch docs/handoffs/animation-resume/owned-stashes.bundle "refs/handoffs/animation-resume/*:refs/handoffs/animation-resume/*"
```

These commands import recovery references without applying or dropping any stash. Inspect a recovered commit with `git show` or compare its first parent with `git diff`. Do not blindly apply all historical stashes on top of modern main.

| Stash commit | Disposition |
| --- | --- |
| `fa65db11465a2a1ef2e98bf9a43ef85f79fc4dc3` | Deferred shower runtime code and untracked projection test; reconcile after accepted shower art. The separate readable patches are also preserved. |
| `603386124df8434496c40e4eeae3188ea74bb667` | Earlier aquarium staging and ottoman runtime checkpoint before synchronization. Superseded by the later published aquarium and seating work; recover if a historical diagnostic is needed. |
| `f8e9208e999967b681b6984f471791b250a5dc3b` | Earlier aquarium/ottoman checkpoint; same superseded status. |
| `d6cf83cc8ff474505fa85bec8990af2d3b059174` | Earlier visual checkpoint before main synchronization; preserve as history rather than replacing approved modern assets. |
| `60c8b6bab1e500da9196339bae555013b3c00338` | Earlier aquarium work before audio integration; superseded historical implementation. |
| `5e44db2fadb354ff11e9ce8f5db68c9554c0a23d` | Earlier aquarium/offline-seating checkpoint, including untracked parent when present; inspect its path inventory if recovering an earlier experiment. |
| `dcf9d46e0c0bb93113415e7d9fe1a205ec9bda29` | Sleep-schedule tests. All three named tests are already present on the checkpoint and fetched main: authored starter/newcomer offsets, exact save continuation and hash ownership. No separate sleep implementation is left to publish from this stash. |

Four named object-menu/household-chores stashes and two unlabeled autostashes containing mood/waiting work were not attributed to this conversation. They remain untouched and are not packaged. The bundle preserves the conversation-owned stashes without depending on local reflog positions. `package-owned-stashes.py` records how it was built; do not run that capture utility on a fresh machine before importing its recovery refs.

## Environment and verification

Use `rust-toolchain.toml` and the lockfiles. The checkpoint toolchain specifies Rust 1.94.1, clippy/rustfmt and `wasm32-unknown-unknown`. Observed export host used Python 3.14.7, Pillow 12.3.0, Node 24.14.1 and wasm-pack 0.15.0. Existing exporters are byte-reproducibility sensitive; do not silently choose a different Pillow version. Blender is required for authoring, not for replaying the retained source receipts. Check `blender --version` on the new machine; no exact previous Blender version is established by this handoff.

For an existing checked-out project, inspect tools first. For a fresh machine with missing tools, install the repository's specified toolchain and locked web packages. Do not copy `node_modules`, `target`, ignored WebAssembly output or certificates from the former machine. Rebuild them. No `.env` is needed for the offline animation path.

| Gate | Last observed result | Required follow-through |
| --- | --- | --- |
| Toilet native workspace tests | 1,515 tests passed before final handoff changes. | Rerun affected tests after merging newer main or changing runtime. |
| Native clippy | `cargo clippy --workspace --all-targets -j 2 -- -D warnings`, exit 0. | Preserve strict warnings on integration. |
| WebAssembly build | `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, exit 0. | Rebuild after runtime integration; ignored output is not transferred. |
| Contract/export pure tests | 23 tests passed, but they missed the near-double-winding failure. | Add the failing handoff regression to the proper suite and fix its mechanism. |
| Bath wall support | Missing helper; expected red. | Implement and measure it before claiming a supported pose. |
| Atlas rebuild | Rejected stale `toilet-03` dependency. | Generate new export, update exact pins and rebuild successfully. |
| Web tests/typecheck/build | New bathroom tables absent; not passing. | Complete after atlas generation. |
| Browser graphics/played toilet | Not run. | Verify independently; source beauty is not browser evidence. |
| Bathroom public deployment | None. | Verify after approved usable batches reach main. |

After fixing the corresponding blockers, use these commands from the repository root. Keep host memory bounded and avoid overlapping heavy suites.

```text
python -m unittest discover -s assets/models/bathroom/actions -p "test_*.py"
python assets/sprites/gen/build.py
python assets/sprites/gen/build.py --check
python -m unittest discover -s assets/sprites/gen -p "test_*.py"
cargo test --workspace -j 2
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -j 2 -- -D warnings
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
npm --prefix web ci
npm --prefix web test -- --maxWorkers=1
npm --prefix web run typecheck
npm --prefix web run build
node --test scripts/build-changelog.test.mjs
node scripts/build-changelog.mjs
python check-doc-ids.py
git diff --check
```

Run source-specific pure tests while bath's intentionally missing helper is still pending; report that scope explicitly. Do not describe a focused pass as the full bathroom suite. Use `export_toilet_loop.py --help` for the new export command and pass `--writer-exited` only after verifying the writer actually exited. The original source can be reused without a Blender job.

1. Prove the baseline 3,055 published sprite records, decoded crops and old metadata tables remain unchanged. Extend the existing preservation checker to the current base and include all old seated-media tables. Atlas indices need to append, not replace history.
2. Validate source/palette/facing/owner matrices, independent beauty reconstruction and retained diagnostic reconstruction bytes. Keep the numerical source gate separate from actual graphics composition.
3. Inspect actual GPU drawing in all facings and colours, at the intended display scale, and verify body versus furniture click ownership. Do not claim fractional-zoom fidelity without inspecting it.
4. Play entry, loop, Pause, reduced motion, Save/Load, cancellation, completion and exit. Verify activity labels, markers, bubbles, needs, sounds and unoccupied furniture restoration. Use a fresh owned context and close it afterward.
5. Create a staged-only clean export that excludes ignored local originals and rerun the build/import gates against it. A passing dirty worktree is insufficient.
6. Fetch and carefully merge current main before final publication. Recheck affected tests when actual source changes warrant it. The owner explicitly said not to wait for duplicate remote CI once equivalent local checks pass; identify pending checks accurately rather than calling them passed.
7. Apply the changelog skill before every branch push and merge. This checkpoint itself is internal preservation and has no public release note. The withdrawn toilet draft was not added to the already-published 2026-10-05 entry. After the runtime is ready, put its truthful note in the actual delivery date's entry; recheck dates and preserve other contributors' notes.
8. Commit and push in separate calls. Create and attach any release PR. Merge normally without coauthors, attribution, force, admin bypass or weakened checks. Verify its merged state and presence on remote main.
9. Verify the exact main revision's real Pages deployment step, public bundle and fetched atlas bytes. Check the actual played interaction publicly. Record one scoped dated evidence update if needed; do not create recursive evidence-only release commits.

## Preserved files and intentional exclusions

The branch preserves unfinished native/web/build code, all bathroom authoring modules and tests, accepted toilet sources and loop/ink passes, rejected shower and bath diagnostics and editable sources, historical exports, the two earlier rejected neutral-seating exports, source dependency snapshots, dated reports and selected verification logs. `animation-resume/inventory.json` lists exact checkpoint bytes; run its verifier after cloning. It deliberately excludes its own digest to avoid a self-referential hash.

1. Local `.tmp/`, credentials, certificates, provider account data, machine profiles and personal saves remain private. None is required by the offline source path or current animation receipts.
2. Old multi-gigabyte `.tar`/`.zip` clean-checkout copies and duplicate build outputs remain local. Their underlying repository sources and relevant verification reports are preserved; copying those archives would not add a unique implementation dependency.
3. Historical evidence scripts copied into `animation-resume/evidence/` can retain former-machine absolute paths or output paths. Treat them as diagnostic provenance, not portable execution entrypoints. Use current authoring modules and the portable verifier/reproducer above, or deliberately adapt a historical script before running it.
4. Other tasks' stashes are not transferred or changed. The owned deferred shower stash is exported explicitly. No active source writer, browser context or preview server is intentionally left running for the new machine to inherit.

Finish all remaining animation rows, the missing-action audit and the required publication evidence. The previous agent left known failures openly recorded; neither a successful transfer nor a checkpoint push closes those implementation obligations.
