# Player orders, attendance and action diagnostics

The integrated persistence format is V17: `SaveSnapshotV17` wraps the complete
published V16 room envelope and its published V15 conversation envelope, then
adds player-order ownership and attendance. Current capture and restoration
use `save_snapshot_v17` and `load_snapshot_v17`; published V15/V16 readers and
wire layouts remain supported.

Issue #273 defines this change. Player orders retain stable identity from
acceptance through completion, cancellation or an explained failure. A path or
reservation release does not cancel an order. Critical needs never override
player orders; need decay and death remain enabled.

## Execution

1. Track queued, approaching, waiting, running, completed, canceled and failed
   states. Audit every player-order removal across social, object, reading,
   recipe, chore and cleanup actions. Transfers retain their original identity.
2. Incoming conversations reference the initiating order rather than creating
   another executable order. Display an Incoming caption and directional mark.
3. Finish the recipient's current activity, then serve eligible incoming orders
   in acceptance order before their other queued actions. A request becomes
   eligible only when its initiating order is ready. Reserve neither participant
   for future requests. Break reciprocal reservation cycles deterministically by
   acceptance order and stable person identity. Execute repeated orders separately.
4. Approach an adjacent reachable position and wait beside busy recipients.
   Follow moving recipients through their current activity. Busy never means
   failed, and waiting has no timeout. A new explicit front order may redirect
   either person without deleting another person's request.
5. A person who is only waiting for their own autonomous chat is not busy to
   an order addressed to them. When that order is admitted, the chat is
   suspended with its identity and age and resumes after the order's
   conversation releases them. This applies to player and game-made orders,
   so a cycle that mixes pending chats with orders always has a ready
   order. Cycles of chats alone still use the oldest-request rule, and
   cycles of orders alone still use acceptance order. Proposed ruling for
   issue 301, awaiting the owner's confirmation: the order goes first even
   when the waiting chat is older, because orders outrank autonomy.
   Game-made fight orders yield to critical needs as the
   [fights](2026-10-16-fights.md) rule 3 describes; player orders do not.
6. Unreachable destinations, removed targets and invalid actions fail with a
   recorded reason. Cancellation is a separate outcome. Show a frustration
   squiggle above the initiator for three real-time seconds on failure, alongside
   a readable status reason. Never show failure feedback for waiting, completion
   or intentional cancellation.

## Work

1. Save scheduled shifts and actual attendance. Player orders delay departure.
   Leave once orders finish if the original scheduled shift has time remaining.
2. A confirmed new order interrupts an outbound commute or brings an off-lot
   worker home along the normal return route. Finish player orders and resume
   work within the original shift. Never extend its end.
3. Before submitting a new order conflicting with work due or underway, pause
   using the existing overlay controller. Show Proceed and Cancel, the affected
   people, remaining and total shift hours, and pay/performance consequences.
   Confirm all affected participants together. Cancel submits nothing and changes
   no queue or attendance. Proceed submits once. Restore speed and keyboard focus.
   Revalidate the conflict when applying input. Older orders cause no later prompt.
4. Prorate integer-cent pay, shift energy cost and rewards by actual worked time.
   Settle each scheduled shift once even after repeated interruptions. Allow two
   hours of missed work, then deduct ten performance points per further hour,
   prorated by minute and clamped at zero. A missed entire shift earns zero pay
   and zero score. Attribute attendance to the scheduled shift's week.
5. Retain scheduled, worked and missed minutes, base score and deduction. Explain
   attendance in career details. Emit an outcome usable by future issue #275.

## Interfaces and persistence

1. Record acceptance, approach, waiting, start, resumption, completion,
   cancellation and failure once per transition. Include tick, actor, counterpart,
   order identity, action, reason and blocking state. Keep 2,048 session-local
   records with sequence cursors and explicit expired-history reporting.
2. Expose incremental records through Rust, WebAssembly and the browser bridge.
   Show selectable-person history with Copy in the debug panel. Log terminal
   failures to the console once. Full issue #275 activity-stream UI is excluded.
3. Add structured queue rows with identity, phase, role, counterpart and reason.
   Preserve the existing label API as a compatibility projection.
4. Save and hash gameplay ownership, request ordering and attendance in the next
   schema version. Preserve all frozen readers. Migrate old orders deterministically.
   Diagnostics and transient visual feedback are outside gameplay saves and hashes.
5. No dependency changes. Diagnostics must not consume random draws or affect
   behavior, and must retain events across several ticks in one browser frame.

## Acceptance

Start tests with real public commands. Cover critical needs on both sides,
busy recipients, repeats, reciprocal and competing requests, redirects,
cancellation, unreachable/removed targets and death. Assert exact identities,
reservation cleanup and one terminal outcome. Cover deferred departure,
outbound interruption, early return, resumption, repeated interruptions,
overnight shifts, week boundaries, missed shifts and settlement exactly once.
Test confirmation acceptance/cancellation, stale and multi-person input,
paused/accelerated play and older orders without retrospective warnings.

Round-trip each lifecycle boundary and compare later behavior and hashes.
Verify diagnostics are bounded, incremental and behavior-neutral. Run native,
browser, type, lint, formatting, WebAssembly, production and targeted mutation
checks. Measure diagnostics cost. Inspect desktop and phone cards, warnings and
failure indicators in played browser sessions. Obtain a fresh visual review
that rejects the known missing-feedback result. Retain screenshots and written
evidence only. Close task-owned pages and preview servers afterward.

Update the relevant system docs, lessons learned and public changelog before
delivery. Implementation and verification records belong in dated evidence.
