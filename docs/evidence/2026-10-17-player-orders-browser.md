# Player-order browser verification

The [complete verification record](2026-10-17-player-orders.md) separates native
tests, browser tests, played behavior and independent image inspection. This
record describes the browser contracts and deliberate mutation receipts.

## Final browser checks

The full 265-file run passed 3,442 cases and timed out one unrelated crop-head
geometry case. Its complete 14-case file passed on rerun with the same timeout;
the affected case took 13.365 seconds against its 30-second limit.

After the final native admission repair, 70 related files ran against the rebuilt
WebAssembly. They passed 890 cases and exposed one older sale-refusal fixture
that tried to use an actionless floor lamp. The fixture now uses the exercise
bike and asserts its public action before testing the same refusal. All 25
builder cases passed afterward. The new invalid-future-order case passed against
the final binary after failing against the preceding binary.

Tests ran with `npm test -- --maxWorkers=1`. The related run and file reruns
also used `--reporter=verbose`. Type checking and the production build passed.
There was no timeout increase, assertion removal or skipped gameplay case.

## Interface contracts

1. Event cursors and order identities cross the bridge as decimal strings,
   including values above JavaScript's exact integer range. Incremental reads
   preserve transitions across multiple simulation ticks in one browser frame.
2. The debug panel filters by either participant, reports expired history and
   copies the selected history. Warnings occur once per failed or rejected
   sequence. A rejected submission has no accepted order identity and does not
   create a frustration bubble.
3. Failure bubbles use animation-frame time and actual configured head positions.
   They last three real seconds, follow camera projection and clear on successful
   Load. World feedback draws behind interactive panels.
4. The work gate intercepts all eight raw and typed order entry paths before
   staging input. It includes all affected participants, holds one submission,
   forwards the displayed approval token once and handles stale refusal.
5. The modal uses the existing pause owner and restores speed and visible focus.
   Cancel submits nothing. Book commerce and chore preferences do not create
   executable orders and do not enter this gate.
6. Incoming rows reference the initiating order. Their direction and counterpart
   differ from the recipient's own executable queue. The compatibility empty
   current-action row remains valid and does not render a blank Running card.
7. Career details show scheduled, worked and missed minutes, base performance,
   attendance deduction, final score and earnings.

The actual browser Save/Load check preserved a real book return and its valid
queued sleep action after an invalid action failed. Load cleared the transient
history, bubble and failure status. Copy was verified with a clipboard stub in
the isolated task context, leaving the user's clipboard untouched.

## Deliberate browser mutations

Each mutation changed one production mechanism. Each test failed as shown.
Original bytes were restored in a `finally` block and checked with SHA-256.
The corresponding unmutated cases passed again in the final related run.

1. Replacing `nowMs + 3000` with `nowMs + 300` failed the expiry assertion at
   2,999 ms: `expected Set{} to deeply equal Set{ 7 }`.
2. Removing the sequence-cursor filter failed the consume-once assertion:
   `expected "vi.fn()" to be called 1 times, but got 2 times`.
3. Removing `pause.suspend('work-order')` failed the pause ownership assertion:
   `expected "vi.fn()" to be called with arguments: [ 'work-order' ]`, with zero
   calls recorded.
4. Replacing the incoming-role condition with false failed the caption assertion:
   expected `Incoming ← · Waiting`, received `Waiting`.
5. Bypassing `orderGate` and calling `submit()` immediately failed the eight-path
   bridge assertion: the function was called four times before approval. The
   test checks raw and typed paths separately, participants, token forwarding
   and the submission callback's one-use guard.

## Browser storage version gate

The current save header accepts version 15 and preserves version 14 bytes in a
separate recovery file before its first write. A frozen version 14 worker refuses
to overwrite the newer slot. Tests also preserve the historical byte fixtures,
protect unreadable/newer saves, serialize simultaneous first writes under the
origin lock and leave storage untouched when a lock fails.

Both real WebAssembly player-order cases passed: canceled multi-person work
confirmation leaves the world unchanged; separately confirmed orders retain
distinct identities in one paused batch; an invalid future action produces one
accepted/failed pair and leaves a loadable valid queue.
