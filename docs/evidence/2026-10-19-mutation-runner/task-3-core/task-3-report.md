# Task 3 implementation handoff

The implementation is frozen for independent spec and quality review. All 167 relevant CI-script tests passed across the focused commands below. No workflow was dispatched, tool was built or installed, native suite was run, commit was created, or branch was pushed by this worker. Root owns real GitHub fixture qualification, production capacity measurements, the full campaign and delivery.

Base checkout: `0b886b73d8fb0492fe8e8029957e0fc1db5715a7`. Review package: `task-3-review-package.diff`, SHA-256 `b1036193ba11b06f2e986e54298a669ad0a079192a459b2a4fec80dfd892e813`. Exact file hashes are also in `task-3-file-hashes.json`.

## Scope and interfaces

1. The existing registered workflow now has distinct fixture and production checks, an immutable original plan, current-attempt recovery preparation, eight fixed workers and failure-aware aggregation. Tool preparation, original planning and recovery preparation sequentially acquire the existing global slot zero. Workers retain the eight global `ci-mutation-shard-N` groups, pending queues, cancellation rules and 120-minute caps. Aggregation is a separate lightweight job after workers. Existing Rust, web, classifier and Pages behavior is preserved; explicit fixture mode avoids unrelated Rust/web builds. No dependency, toolchain or action version changed. Permissions are explicitly `contents: read` and `actions: read`.

2. `mutation_tool.py` builds only the approved upstream commit and exact patch, checks the reviewed patched tree/lockfile, runs ten selector assertions, and emits one executable/receipt artifact. The pinned identities are upstream `8ab1dc786a1f61a4e370416cc6c68b81a704e917`, patched tree `2f083ac6d2d2e88bf99e863b0b0f74774f986005`, lock SHA-256 `0d2699c31955d28f429731eda2972dc4faced07747320b074bc774c3334f75c0`, and patch SHA-256 `6693b7a61b4c7cb398e199c4e33675f9267bc50559790e069341be377f32ba6f`. Binary provenance is independently authenticated. Runtime identity binds Ubuntu image/version, architecture, ELF interpreter, loaded-library hashes and verbose rustc/Cargo versions. Consumers restore permission only after byte verification and invoke the same absolute binary.

3. `mutation_runner.installed_tool(root, env, settings=None)` retains its compatibility default for existing callers, but workflow settings require an explicit path, expected SHA and authenticated tool contract. That contract flows through existing calibration/context identities. `selected_workspace` copies the exact root toolchain pin into the fixture and fingerprints it; a missing pin cannot use the host default. The tool selector probe uses that same pin.

4. `mutation_artifacts.authenticate_producer` now returns the authenticated job plus exact log bytes/SHA without changing its existing checks. Existing callers may ignore the return. `AuthenticatedRecovery` and `checked_recovery` provide a typed in-process handoff, bound to manifest/run/attempt/current-evidence policy. Plain decoded JSON cannot enter it. `execute_slot(..., recovered=None)` and `aggregate(..., recovered=None)` accept the optional keyword-only verified input and rerun model merging plus their existing current-source checks. The original raw `recover` API, model, survivor allocation, baseline policy, timeout policy, process cleanup and pre-signal snapshot boundary remain intact.

5. `mutation_recovery.py` authenticates immutable prepared/aggregate artifacts and losslessly interns repeated proof data. It retains original delta references and digests, original producer-log bytes and original retention, ordered started-worker/preparation inventories, terminal verdicts, original plan/tool/qualification references and sealed run frontiers. Fresh full artifact inventories must still contain every original with matching ID/name/digest/expiry. Only the bounded new tail is downloaded and raw-report validated. Reconstruction uses the existing model and counted survivor rules; copied evidence receives no new execution identity.

6. `mutation_qualification.py` derives the current workflow/helper/fixture contract locally and compares committed Git blob identities through bounded, non-truncated Git-tree responses. It never executes downloaded code. Initial qualification authenticates the original plan, raw reports and same-run interruption/resumption proof. Later consumers authenticate the current preparation receipt and compare the current contract/tool/runtime; they do not replay the entire fixture history in nine clients. A later aggregate-only or explicit-chain proof may retain a historical same-run interruption/resumption pair, but cannot substitute a cross-run pair.

7. External continuation now targets the authenticated numeric `mutation-prepare` job ID, or `mutation-fixture-prepare` for fixtures, and its dependents. It leaves original calibration, Rust and web jobs untouched. Generic `--failed` supplies stale preparation and is refused before mutation work. Successful slots validate current inputs and prior coverage, then execute zero mutations. Aggregate-only refresh remains supported without requiring eight current worker jobs. Missing uploads from workers that actually started and failed preparations remain fatal. No job self-dispatches.

8. Limits are fixed: seven-day campaign, two-day recovery margin, 30-day requested artifact retention, 51 attempts per run, at most eight explicit campaign runs, at most two additional proof-source runs, at most three missing-snapshot attempts and 16 artifact-list pages per referenced run. A malformed newest snapshot is fatal. Advancing a sealed predecessor fails. Snapshot archive, expanded chunks and reconstructed logical proof are each bounded by 128 MiB; chunks stay at 32 MiB. Tool transport alone has a 256 MiB binary plus 1 MiB receipt capacity bound. Raw result bounds were not widened.

## Validation

| Command | Observed result |
| --- | --- |
| `python -B -m unittest discover -s .github/scripts -p 'test_mutation_*.py'` | 139 tests passed in 82.292 seconds. |
| `python -B -m unittest discover -s .github/scripts -p 'test_workflow_*.py'` | Eight tests passed in 0.521 seconds. |
| `python -B -m unittest test_changes test_pages_changelog` from `.github/scripts` | 20 tests passed in 22.003 seconds. |
| `python -B check-doc-ids.py` | Unique allocation-free documentation IDs. |
| Existing installed PyYAML `BaseLoader` parse | All ten workflow jobs parsed; no package installed. |
| `git diff --check` and added-line punctuation scan | Passed; no authored em/en dashes. |

Twelve new isolated fault controls remove one acceptance boundary in disposable copies: executable digest, runtime equality, committed helper blob identity, exact fixture coverage, changed-head stop, global concurrency group, eight-slot count, aggregate-after-failure condition, read-only permissions, retained original-log digest, snapshot archive digest, and terminal-failure preparation refusal. Every altered copy produces the named ordinary assertion failure, not a syntax/import error. Live source bytes remain unchanged. Existing Task 1/2 controls also run in the 139-test suite.

The integration tests exercise exact raw reports and authenticating API fixtures; complete interrupted/resumed fixture evidence; wrong repository/event/commit/helper/producer; original deletion, expiry and digest change; fixed calibration recovery; current validation failure despite complete history; zero-work completed slots; stale preparation; sealed predecessor advancement; missing started-worker uploads; malformed newest snapshots; bounded replay; lossless record/log reconstruction; cyclic/oversized graphs; and token-local quota admission before preparation.

## Request and byte evidence

The original repeated-history design measured 1,656 / 4,914 / 8,172 requests for eight workers plus aggregation at 10 / 30 / 50 attempts, before additional tool/qualification overhead. The retained fixture proof alone cost 63 requests per client before the transport revision. Those rejected-design measurements remain in `task-3-api-cost.json` and `task-3-api-cost-notes.md`.

The new counting fixture invokes the actual current preparation, all eight worker adapters and aggregate adapters, including current-job metadata, original-plan restoration, tool artifact verification, current prepared-proof authentication, original inventories, run-log probes and token-local remaining/reset queries. Native compilation/enumeration/runtime probes are substituted with deterministic fixture context; no network requests occur. It uses 24 fully validated identities, followed by legitimate zero-work completed-slot bundles to grow history. This measures request demand, not native workload size or throughput. The two extra proof-source references in the worst case are synthetic retained seed evidence; their initial authentication is covered separately by the tool and qualification suites.

| Last-run history | Campaign runs | Missing snapshots | Inventory / external sources | Preparation | Each worker | Aggregate | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 1 | 0 | Observed fixture pages / no extra proof runs | 23 | 13 | 38 | 165 |
| 30 | 1 | 0 | Observed fixture pages / no extra proof runs | 25 | 13 | 40 | 169 |
| 50 | 1 | 0 | Observed fixture pages / no extra proof runs | 27 | 13 | 42 | 173 |
| 50 | 8 | 0 | Observed fixture pages / no extra proof runs | 76 | 13 | 91 | 271 |
| 50 | 8 | 3 | 16 pages per campaign run / 2 extra proof runs | 224 | 13 | 185 | 513 |

The eight-run shape contains seven 51-attempt runs and 50 historical attempts in the final run, followed by the tested current attempt. The measured worst case is 513 requests, below the 800-request nominal ceiling. Each job also enforces a local request/time ceiling. Preparation requires 800 requests remaining on its actual job token; workers require 50, aggregation 400, original planning 400 and tool preparation 100. Preparation/aggregation retain fresh timestamped observations. A local controller token has a different rate bucket; the controller must use the job observations with their freshness limits and wait outside slots. Other repository activity can still cause fresh admission to refuse.

Byte capacity is not established by the small identity fixture. The codec enforces the 128 MiB logical/encoded proof ceilings before sealing and rejects unsafe or excessive reconstruction. Real V20 full-manifest outcomes, original log bodies, peak memory, parse time, downloads and uploads still require Linux plan/pilot measurement. The old 17,749-entry Windows V19 inventory is historical and is not used as current production proof.

## Evidence policy and remaining gates

1. Retained original producer-log bytes are transitive authenticated evidence with their original expiry, not a fresh fetch of every old GitHub per-job URL. A non-following authenticated run-log request requires the documented 302 plus an HTTPS location, which is never logged, saved or followed with credentials. It proves only that GitHub issued a current run-log download location. A latest archive cannot attest to every older attempt. Known missing originals still refuse; original result artifacts remain required and freshly inventoried.

2. The read-only token cannot query the repository Administration retention endpoint. Producer receipts retain actual `GITHUB_RETENTION_DAYS`; reuse checks both that producer value and the current configured value, plus each actual artifact expiry. Copying a proof cannot renew its eligibility.

3. Real GitHub workflow syntax/scheduling, actual run-log redirect availability, original job-log availability, exact Linux binary/runtime transport, same-run targeted preparation rerun, process-group cleanup and interrupted/resumed result reuse remain unobserved. Root must run the real small fixture first. No local API fixture is described as GitHub qualification.

4. Root must regenerate the complete V20 native inventory and establish cold preparation, baseline/build caps, representative mutation rebuild/test throughput, shutdown, validation, artifact bytes/upload time and finite full-campaign feasibility before the game sweep. Initial reserves remain conservative unmeasured inputs: 30 seconds shutdown, 120 validation and 240 upload. Runtime-image drift deliberately invalidates qualification/campaign reuse.

5. Operations documentation now describes matching full-workspace baseline commands, immutable plans and caps, exact coverage, global counted allowances, external targeted continuation, current-source validation, retained log evidence and finite limits. Historical baseline results remain historical; obsolete July "Latest sweep" wording and per-shard allowance claims were corrected. These CI internals have no player changelog entry; root owns player-facing UI notes.

## Frozen files

| Path | SHA-256 |
| --- | --- |
| `.github/workflows/ci.yml` | `9109c1b829181299f8dc24f156461d7b260b5c77f9f9dfdf0faf31f336c5bfd5` |
| `.github/cargo-mutants-27.1.0-struct-filter.patch` | `6693b7a61b4c7cb398e199c4e33675f9267bc50559790e069341be377f32ba6f` |
| `.github/scripts/mutation_artifacts.py` | `8584d4771decc7dd57cdab8b0198a33dfd35b0542cc5cfd4fdccc896c454aac6` |
| `.github/scripts/mutation_runner.py` | `d41f227ece1065b91faf8310c906d849872fe95f4664827b0d8877905aef6c4d` |
| `.github/scripts/mutation_tool.py` | `b0f6a2beed1c741637f1de5e3df63598714f00e46c78c6fb8e6aac27942f461e` |
| `.github/scripts/mutation_qualification.py` | `b5f35141c3744cdd2dc62bb016a8f36c3c4cc6daadd25f8730b5a03e0cd25870` |
| `.github/scripts/mutation_recovery.py` | `27ff835ef8cf5782a8569ac1473e82651d7d3893cf8d7bb500fd8eb940632185` |
| `.github/scripts/mutation_workflow.py` | `d97b9152c6d431f49478d6db331aa2ff25e91c25cc3db74f1f4de1fcde7b6ea5` |
| `.github/scripts/test_mutation_artifacts.py` | `d60d2bba018d05c160fccfd2e554eef2975ee7fb8771e87f80e60489aeffe01f` |
| `.github/scripts/test_mutation_runner.py` | `69f1921a8956b2a06fa1635d3596d70ad0036aaec52b01c12e3f06654f7b32c4` |
| `.github/scripts/test_mutation_tool.py` | `e14566399d0b4444ef0129658dd8b8f0f49d3c0316ae16b7d15ee1e3da819e70` |
| `.github/scripts/test_mutation_qualification.py` | `7f74d60925cd3a07d31783e461bc6aacec45f7284a969a69a3c59198906b8ff8` |
| `.github/scripts/test_mutation_recovery.py` | `18813900ce85dbc7aa216cc6c64520e882dc768e255bb688d7cbdf8cb03056dd` |
| `.github/scripts/test_mutation_workflow.py` | `712cb0839e2cad4f15e0b5c0449d1c0f5cdd49317b0ef285b7e305938c3904f3` |
| `.github/scripts/test_workflow_concurrency.py` | `d745c0990db8d5c8c1984985cf945985571ee3c04c35d9b8054bb7e6a0e769ce` |
| `docs/mutation-baseline.md` | `854e4d4d4fbd7a29c8d627b2af1c390d34893ee71d0373c1f9a77fb2ec165cd2` |
| `docs/testing-protocol.md` | `4c1f390a180acc684f14617f676dffe6091720c1e406e86ad66564871c595735` |
| `docs/mutation-campaign.md` | `1fd9d8a3cc1a3cee924282108ea12bec66eddbde6be10010dd449c49dd9b33f5` |

Ownership of these 18 files is released for the fresh independent review. This worker has no active process, native build, source mutation, browser, commit, push or workflow dispatch. Root owns all remaining review, fixture dispatch, capacity evidence, production execution and delivery.

**Next steps**: Root should review the frozen package, then qualify the real GitHub fixture and current V20 workload before dispatching the production campaign.
