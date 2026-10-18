# Merge orchestration review

## Real goal

[G1] Finish the existing merge and native V16 integration while preserving published saves and room work. Every subsequent check must refer to a completed command and the source it actually tested; the original V15 producer must remain untouched.

## Diagnosis check

[D1] The repeated failure is losing the operation's state between tool calls. The existing lesson already describes the exact unsafe interleaving: a yielded build remains running, then its executable starts before a successful build exit is observed (`docs/lessons-learned.md:248-260`). The native brief requires a completed build and retained fingerprints (`.superpowers/sdd/2026-10-17-room-identities/task-native-v16-integration-brief.md:30`). A running poll is not a completion event. Missing or truncated output is also not a completion event.

[D2] The current merge reached the expected conflict-resolution phase. Read-only inspection at approximately 2026-10-17 18:18 Pacific found branch `twcx/room-identities`, HEAD `084643c1fdbe950bca5f5ce7ef1dd27726ee4870`, MERGE_HEAD `a481d7c7be0708c4523d9a156513b6696aaff6f6`, 18 unmerged paths and 52 unmerged index stage entries. These match the instructed source inputs (`task-native-v16-integration-brief.md:7`). The log contains 18 conflict entries and ends with the instruction to fix conflicts and commit (`.local-build/native-v16-merge.log:3-59`). The two add/add conflicts account for four stage entries; the other 16 paths account for 48. There is no current-state reason to abort or repeat this merge.

[D3] The worktree-specific index lock is absent. PIDs 60636, 54372, 73908, 78292, 77244 and 31552 were absent during this audit. The Git process inventory showed no merge command. This establishes the inspected state, not the historical order in which earlier processes exited. No process was stopped by this review.

[D4] The caller reports that the last wrapper returned zero after `Get-Content`, losing Git's actual exit status. The log establishes conflicts but does not contain a retained Git exit code. Do not retroactively label that command exit zero or one. There is already a correct local example of capturing `$LASTEXITCODE` immediately, before reading the log (`.superpowers/sdd/2026-10-17-room-identities/native-final-checks.ps1:11-14`). The missing fix is consistent execution and retention of that contract.

## What was taken as fixed but is not

[F1] Large command output does not have to travel through the tool response. Store it in a unique file and return only bounded operation metadata. The control record must survive even if the human-readable log is truncated.

[F2] A missing response does not require another mutation. Recover the retained session and inspect repository state. Unknown completion must remain unknown until reconciled. Repeating a merge to discover what happened introduces a second operation and obscures the first.

[F3] This does not require a new process framework. The tool already supplies a running session ID or terminal exit code, and Git supplies durable merge state. The missing layer is the assistant's sequencing discipline. The native brief already assigns one source/index owner and keeps the original producer isolated (`task-native-v16-integration-brief.md:9-11,33`). Preserve that design.

## Alternative routes

[ALT1] Retain one owner and explicit operation records.

Mechanism: The native owner runs one mutation per tool call, retains the session before emitting output, waits for terminal completion, then checks the expected Git state. The parent keeps ownership of original-V15 producer session 34425.

Work required: Adopt the execution pattern below and release the existing native owner to resolve the current conflicts. No new executable, dependency or orchestration service is needed.

Costs and risks: The assistant must enforce the transition from running to completed. A lost outer tool response remains recoverable through the stored inner result and operation receipt; if both are unavailable, inspect state without relaunching.

Later effect: Each failure has one command, log and completion record. Interactive conflict resolution remains practical.

[ALT2] Use one bounded script for a predetermined validation sequence.

Mechanism: A local PowerShell script owns a fixed sequence, captures each native exit immediately, writes a receipt, and stops on failure. The existing `native-final-checks.ps1:7-15` demonstrates serial execution and failure propagation.

Work required: Define the exact sequence after source freezes and add explicit final success propagation and per-step receipts. Invoke the script once and retain its session.

Costs and risks: Appropriate for known validation steps, but unsuitable for an interactive merge with unresolved semantic choices. A script that continues after conflicts would reproduce the present mistake inside another layer. Building a general process runner would enlarge this task without repairing its ownership decisions.

Later effect: Reduces assistant scheduling decisions for repeatable checks; makes mid-sequence adaptation less flexible.

## Recommendation

[R1] Choose [ALT1], one owner with explicit operation records, and continue the known merge. The source inputs and conflict inventory are coherent. An abort/retry would discard useful merge state and provide no missing proof. Keep [ALT2], a bounded serial validation script, for an already agreed sequence after integration, if useful. Do not build a framework or change game architecture to address an assistant sequencing failure.

## Exact execution pattern

[P1] Before releasing the native owner, recheck the worktree path, branch, exact HEAD and MERGE_HEAD above, absence of `index.lock`, and the 18-path conflict list. These are initial resume checks, not permanent assertions: the conflict count should shrink during authorized resolution. If HEAD or MERGE_HEAD differs unexpectedly, pause mutations and reconcile ownership. Do not reset, abort, remove a lock, or restart Git automatically.

[P2] For each future native mutation or heavy command, choose unique log/receipt paths and record the exact executable, arguments, working directory and source identity. Run only that operation in its execution call. A minimal PowerShell envelope is:

```powershell
$ErrorActionPreference = 'Stop'
& $program @operationArgs *> $operationLog
$operationExit = $LASTEXITCODE
[pscustomobject]@{
    program = $program
    arguments = $operationArgs
    cwd = (Get-Location).Path
    log = $operationLog
    exit_code = $operationExit
    finished_utc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $operationReceipt
Write-Output ("exit_code={0}; receipt={1}" -f $operationExit, $operationReceipt)
exit $operationExit
```

Supply those variables explicitly for the particular operation; this is a pattern, not a script to run with unset variables. Never append a log reader and rely on its success as the native exit. If receipt writing fails, treat wrapper failure separately and reconcile the operation from its log and durable state before any further mutation. Do not reuse the existing merge log or rerun the current merge to obtain a better receipt.

[P3] In `functions.exec`, await the nested command, save its full result before displaying it, then emit a small control record first:

```javascript
const result = await tools.exec_command(operation);
store(operationKey, result);
text({
  operationKey,
  session_id: result.session_id ?? null,
  exit_code: result.exit_code ?? null,
  state: result.exit_code !== undefined ? 'completed'
    : result.session_id !== undefined ? 'running' : 'unknown'
});
```

Use explicit output limits. Read log excerpts separately. If the outer call yields a `functions.exec` cell ID, resume that cell with `functions.wait`; do not launch the underlying command again. If the nested command returns a session ID, retain it and use `write_stdin` until it returns an exit code. Each poll must replace the retained control record before any log excerpt is emitted. No exit code means no dependent command. A transport error means reconciliation is required, not permission to retry a mutation.

[P4] Preserve the separation between command outcome and repository state. The historical merge exit is unknown, while its current conflicted state is verified. Resolve those conflicts through the existing native owner. Before committing, require no unmerged entries, review all staged resolutions and non-conflicting incoming changes, and complete the planned integration checks. Do not infer semantic correctness from Git's conflict markers disappearing.

[P5] Keep parent-owned producer session 34425 and `.local-build/p15-a481`/`p15-target` untouched. Native edits may proceed under the existing ownership agreement, but Cargo and heavy validation remain held until the parent releases that slot. A native test executable must wait for the successful completion record of its own build and must use that build's source/artifact identity.

## Verification and remaining limits

[V1] This review used only read-only Git/process/log inspection and wrote this report. It did not mutate the index, resolve conflicts, run Cargo, launch tests, stop processes or query the parent's build session.

[U1] Earlier tool transcripts were not supplied in this fresh context. The truncation, duplicate launch and trailing-`Get-Content` history remain caller-reported. The existing lesson corroborates the premature executable launch; the current Git state and merge log were independently verified. Original tool responses would settle the precise historical session/exit sequence. Do not recreate that sequence by rerunning mutations.

[U2] This audit does not establish that any conflict resolution or V16 behavior is correct. That requires the integration owner's work and the planned native, fixture and later browser evidence. It also does not establish the original producer's current build result; the parent retains that responsibility.

**Next steps**: The parent should adopt [ALT1], one owner with explicit operation records, refresh the resume checks, and release the native owner to continue the existing merge while retaining the heavy-build hold.
