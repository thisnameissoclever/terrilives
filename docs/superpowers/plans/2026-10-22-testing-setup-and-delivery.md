# Testing setup and delivery implementation plan

> **For agentic workers:** Use the parallel-agent workflow for the independent implementation tasks and execute hosted qualification directly. Obtain fresh review before merging. Keep an execution ledger in ignored task storage.

**Goal:** Restore authenticated mutation-test planning and reduce redundant delivery work while preserving meaningful verification.

**Architecture:** Keep fixture qualification, exact runtime identity, recovery authentication and native admission intact. Run independent CI guard and artwork verification alongside normal checks. Publish automatic releases using the exact successful CI run's tested WebAssembly package; keep fresh builds for manually validated releases. Fetch only the metadata and classifier needed to reject stale publication.

**Technology:** Existing Python standard library helpers, GitHub Actions, Git, Rust, Node and their currently selected actions. No dependency or toolchain upgrades.

**Spec:** `docs/mutation-campaign.md`, `docs/testing-protocol.md` and the owner's October 22 repair and delivery request.

**Requirements:** The owner's October 22 instruction authorizes repairing the blocked setup, verifying a successful hosted check, evaluating safe reductions and completing delivery through merge without another approval request.

## Constraints

1. Retain every current native, browser, art and CI-script assertion. Parallel execution and reuse of verified output must preserve their authority.
2. Retain eight shared mutation slots, immutable plans, authenticated interrupted recovery, exact runtime checks and separate native admission.
3. Finalize the mutation computation contract before producing qualification. Changes to its files invalidate earlier qualification.
4. Automatic publication accepts only the expected successful main push run and its exact source revision. Manual publication retains its existing locally validated main-revision guard.
5. Artifact restoration validates producer, immutable artifact identity, archive digest, complete file inventory and every file hash before writing package files.
6. Stale-release comparison reads the current main revision immediately before publishing, fetches that exact revision and rejects unknown comparisons.
7. Preserve other conversations' checkouts, running jobs, credentials and changes.

## Independent tasks

### 1. CI scheduling and tested package production

**Owner:** CI worker. Own `.github/workflows/ci.yml`, `.github/scripts/test_workflow_concurrency.py` and the relevant scheduling description in `docs/testing-protocol.md`.

1. Run focused current workflow-policy tests as the baseline.
2. Add failing guards for independent complete script verification, independent unchanged artwork verification and guarded mutation execution.
3. Move the complete script suite into `ci-guards`, while retaining fast classifier tests in `changes`. Keep mutation tooling and planning dependent on successful guards.
4. Move the entire existing sprite/model verification step into `art` without deleting commands or changing its code/fixture condition.
5. After successful web tests, record and upload the tested WebAssembly package as `tested-wasm-${{ github.sha }}-attempt-${{ github.run_attempt }}` with the existing artifact action and seven-day retention. Select the package through the current run's latest successful web job, preserving earlier attempts' immutable artifacts.
6. Use `python3 -B .github/scripts/pages_artifact.py record --directory web/src/wasm --sha "$GITHUB_SHA" --repository "$GITHUB_REPOSITORY" --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT"` to create its receipt before upload.
7. Prove guard removals fail and run the focused policy tests. Correct the stale player-guide publication description in the testing protocol.

### 2. Publication reuse and metadata-only release checks

**Owner:** Pages worker. Own `.github/workflows/pages.yml`, `.github/scripts/pages_artifact.py`, `.github/scripts/test_pages_artifact.py` and `.github/scripts/test_pages_changelog.py`.

1. Add failing tests for package receipt creation and restoration, wrong run/repository/revision, unsuccessful or untrusted producers, altered or incomplete archives and file hashes.
2. Implement `pages_artifact.py record` and `restore` using the CLI arguments specified here. The generated `build-receipt.json` accompanies the package. Use existing authenticated GitHub byte transport and archive validation rather than another download implementation.
3. Automatic publication reuses only the triggering successful main push run's package when its web job succeeded. A notes-only run and every manual release build fresh.
4. Use `python3 -B .github/scripts/pages_artifact.py restore --directory web/src/wasm --sha "$TESTED_SHA" --repository "$GITHUB_REPOSITORY" --run-id "$RUN"` to restore the package.
5. Preserve explicit rejection of missing or invalid expected artifacts. Do not turn integrity failures into silent rebuilds.
6. Replace the deploy job's full repository checkout with a bounded partial/sparse checkout containing the classifier. Keep its source revision exact and use a bounded exact-current-revision fetch when main moved.
7. Add structural and behavioral controls proving stale content cannot publish and unknown comparisons fail closed. Run the focused policy and artifact tests.

### 3. Hosted setup and delivery

**Owner:** Primary assistant. Own diagnostic and release evidence, qualification diagnostics and their integration tests, mutation-operation and lesson documentation, integration, hosted qualification and merge.

1. Integrate the independent changes and run CI-script tests, classifier fault controls and appropriate build checks. Review changes before refreshing any source fingerprints.
2. Obtain independent review of authenticity boundaries, skip conditions, permissions and preserved coverage.
3. Push the final reviewed contract and dispatch a fresh fixture campaign on that revision.
4. Confirm the intended first-attempt checkpoints after authenticated completed work. After the attempt finishes, rerun the successful numeric fixture-preparation job and its dependents.
5. Require exact resumed fixture completion and the real qualification artifact. Do not accept a local mock as hosted qualification.
6. Rerun or dispatch production planning against that qualification and require the previously blocked plan check to succeed. Keep later production admission and campaign completion distinct from this proof.
7. Record actual hosted timings and qualification references in dated evidence. Describe scheduling projections separately from measured improvements.
8. Apply changelog policy, merge the reviewed changes, verify remote main, and exercise the changed publication route. Leave a clean checkout.

## Review focus

1. A green cached package from another revision or repository must never become this release.
2. A successful classification job must not authorize mutations before the complete guard suite passes.
3. Moving artwork verification must not hide a failed generator or dropped model test.
4. Stale guide content, public notes and renamed files must remain publication inputs.
5. Runtime-image drift remains a refusal, and a first fixture checkpoint remains incomplete until authenticated recovery finishes.

## Exclusions

No genuine test is selected for removal on the present evidence. Full compiled target caches, cross-revision package reuse and speculative deduplication of publication are outside this change. The iPhone fix's affected-device confirmation remains separate.
