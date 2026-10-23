# Meaningful debug reports

**Goal:** Record useful evidence throughout loading and play, retain actual errors, and offer the newest evidence in a bounded email from failures, the report page and Options.

**Architecture:** An early, independent recorder owns a bounded browser-local journal. A small event bridge lets downloads, preparation work and graphics report operation boundaries without importing the recorder. Sharing reads the current journal when activated. The email uses a compact, newest-first excerpt; copy and download retain the larger bounded report.

**Spec:** The owner's request requires actual errors and meaningful logs from the entire attempt, newest logs prioritized within the mail link's capacity, and Report bug in Options with the same email behavior as Email Tim.

## Constraints and decisions

1. Preserve existing saved households, loading behavior, original console output and cached recorder compatibility. Add no dependencies or automatic reporting.
2. Keep the stored report within 32,768 serialized characters. Bound individual errors and log entries, retain loading-phase history and active operations, batch ordinary writes, and persist errors immediately.
3. Preserve errors after the first frame, thrown/rejected strings or objects, causes, worker stack and browser source locations. Capture console diagnostics, resource failures, download boundaries and graphics-device errors.
4. Limit the complete encoded mail link to 8,000 characters. This is an application budget, not a universal mail-client guarantee: neither RFC 6068 nor Apple's Mail Links reference specifies a portable numeric maximum. Preserve actual error context and newest logs; state omissions. Keep complete copy/download available.
5. Native browser-process termination may prevent JavaScript error delivery. Persist preceding operations and liveness without inventing an operating-system cause.

## Implementation and proof

1. Add failing recorder tests for post-ready errors, later errors after controls bind, console errors, object rejection, newest-first email budgeting and bounded persistence.
2. Publish a compatible v3 recorder and keep prior scripts. Add a guarded diagnostic event bridge, download and preparation boundaries, graphics loss/validation capture, and Options Report bug.
3. Verify error capture and propagation through unit tests and compiled-browser injection. Decode email links without opening a mail client; use an isolated clipboard transport.
4. Update diagnostics documentation, affected guide sections and phone/desktop illustrations, the same-day changelog, and lessons learned. Inspect both guide themes and obtain independent code, architecture, functional and visual review.
5. Fetch the final base, verify the clean candidate with relevant local checks, retain results and platform exceptions, then push, merge, deploy and verify the public result. The original iPhone crash remains open until causal evidence establishes its failure and repair.
