# Held ambience simulation refresh

Merged exact main `c0949f0554f818571b233d0e5f76bb599039a045` locally.
Commit: `bf2a9049867ce1377e4d0f72d1c34946b48ac07f`.
First parent: `81dc2f9b2d25f3b51ee8e2a1ee63db1218703922`.
No conflicts occurred. Both documentation sets and lifecycle regressions survive;
the reviewed simulation behavior was imported unchanged. Complete incoming text
diff and evidence were read. Historical binary screenshots were preserved,
not treated as fresh visual acceptance.

## Checks and frozen build

| Exact command | Exit | Relevant output and verdict |
| --- | --- | --- |
| `Get-FileHash web/src/wasm/terri_wasm_bg.wasm -Algorithm SHA256` | 0 | PASS: `DA49265E97644CB5F3DCC2AEF11EF0406A0682F468145D0DF472640D929BF9DD`, matching supplied release artifact |
| `npm --prefix web run typecheck` | 0 | PASS: `tsc --noEmit`, no errors |
| `npm --prefix web test -- --maxWorkers=1` | 0 | PASS: 1,793 tests in 117 files, 22.09 seconds; full integrated suite run once |
| `npm --prefix web run build` | 0 | PASS: 88 modules, 119 ms; identities below |
| `python check-doc-ids.py` | 0 | PASS: Documentation ids are unique and allocation-free. |
| `git diff --cached --check` | 0 | PASS: no output |
| `git diff --check` | 0 | PASS: no output |
| `git rev-list --parents -n 1 HEAD` | 0 | PASS: exact parents recorded above |
| `git status --short` after commit | 0 | PASS: only root's untracked verification predeclaration and preserved `web/output/` |

Frozen production identities:

1. `index-ChVIKHes.js`: 406,268 bytes.
2. `index-BWCAliOW.css`: 6,891 bytes.
3. `terri_wasm_bg-BwyH47uQ.wasm`: 2,075,724 bytes.
4. `save-worker-Cb-g-Su5.js`: 2,082 bytes.

The first hash command used absent `web/wasm/terri_wasm_bg.wasm` and failed.
The documented generated path `web/src/wasm/terri_wasm_bg.wasm` then verified
the expected hash. No artifact was modified or staged by this worker.

Root was notified immediately after the build and local merge commit. Source
and dist are frozen for the single unchanged acceptance sweep. Root's
`docs/specs/2026-10-01-ambience-post-ecs-verification.md` was left untouched
and unstaged for its separate commit.

## Remaining limits

The matched six-run raw median remains failed at 123,972 bytes against the
unchanged 65,536-byte allowance until root executes the fresh unchanged gate.
The original unmatched 69,120-byte failure and all raw artifacts remain
preserved. No threshold, workload, warmup, compiler subtraction or harness
change was made. Draft PR 184 and separate PR 178 remain release-held.

No Rust rebuild, dependency change, browser run, memory sweep, push, PR edit,
or feature-to-main merge occurred. The passing web suite and production build
do not establish subjective listening, 120 Hz or retained-memory acceptance.
No unresolved integration concern was found.

**Next steps**: Root runs the predeclared unchanged acceptance sweep on this
frozen build and reviews the result. No owner action is needed for this
completed integration step.
