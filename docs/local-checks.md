# Local verification and explicitly approved hosted work

Run checks that this machine can perform locally. A push or pull request does not start the CI workflow. Hosted mutation work requires the owner's explicit approval, an owner dispatch, the exact reviewed revision and the SHA-256 reference of the reviewed local report. Approval for one bounded hosted operation does not approve another operation, a push or a merge.

If the hosted workflow is disabled, obtain approval before enabling it or dispatching work. Keep Pages publication operational under its separate deployable-input rules.

Run the complete local check catalog from the repository root:

```text
python -B scripts/check-local-ci.py run --report .local-build/local-ci/report.json
```

The runner executes checks sequentially. It retains documentation IDs; the complete CI-script and workflow-policy suite; every previous sprite and model contract suite; atlas reproducibility and lossless runtime-storage reconstruction; Rust formatting, Clippy and workspace tests; native and WebAssembly dependency-purity checks; public documentation generation tests and builds; WebAssembly compilation; compiled player-reference validation; web type checks and tests; and the release web build. Python commands use the interpreter running the script. npm commands run from `web/`.

The existing Pillow and NumPy installation command and `npm ci` remain available through `--install-dependencies`. Use that flag only when dependency installation is authorized. Ordinary checks use the installed dependencies. The runner does not upgrade dependencies or toolchains.

Web tests use one worker. Cargo uses at most two build jobs. Node processes receive a 2,048 MiB heap limit. Existing stricter Node and Cargo limits remain in effect, and the report records the chosen bounds. These limits apply to each process; they do not cap the entire machine's memory use. Commands run sequentially.

Use `--group docs`, `--group scripts`, `--group art`, `--group rust`, `--group site` or `--group web` for an affected subset. Repeat the flag for several groups. Use `--list` to inspect the selected command catalog without executing it. A subset report records its actual results and always has `complete: false`.

The report records the checked HEAD revision, the working diff hash, hashes of untracked source files, the platform, each command and working directory, exit status, duration and log path. Reports and logs are excluded from their own source comparison. A failed check stops later work. Interrupted and changed-source runs remain incomplete. Logs sit beside the report in a directory with the `.logs` suffix. Keep this evidence in ignored local storage.

A local pass covers the recorded source state and platform. It does not prove GitHub runner initialization, job-token log transport or authenticated hosted interruption and recovery. Review the report's revision and source hashes against the proposed dispatch revision before using its reference. The owner dispatch supplies that reviewed association; the small hosted authorization jobs validate the owner, exact revision and reference format. They do not rerun or claim to have run the local checks.

The manually dispatched CI workflow has three mutation modes:

1. `plan`, the default, authenticates qualification and proves production planning. It cannot release native measurements, preparation, workers or aggregation.
2. `fixture` retains the authenticated interruption and recovery qualification flow. Its hosted lifecycle evidence remains separate from production coverage.
3. `production` retains the complete campaign's native measurement, owner review, admission, recovery and aggregation boundaries.

The separate `runtime_publish` operation still requires the owner, the exact source revision, the reviewed local evidence reference and its existing image build checks. Package-write permission belongs only to that job. Mutation consumers retain read-only credentials, the immutable image and the eight shared runner slots. Never use a dispatch to repeat routine local checks. Public Pages publication has its own documented approval and input rules.
