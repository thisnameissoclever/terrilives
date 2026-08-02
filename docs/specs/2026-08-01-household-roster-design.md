# Household capacity and roster design

Status: implemented and under release verification.

The M1 roadmap promises a household of up to roughly six sims. Before this
slice, the simulation could spawn an arbitrary authored list, the shipped game
contained three people, and players had to locate small sprites on the lot to
switch between them. That was machinery without a complete player contract.

## [HR1] Six is a validated content boundary

`MAX_HOUSEHOLD_SIZE` is six. An empty household remains legal content for
fixtures and authoring, and one through six members compile in declaration
order. Seven or more fail content compilation with a specific error before
member-level checks run.

The shipped household remains Terri, Doug, and Nadia. Capacity is an engine and
interface promise, not permission to invent three additional named characters
without the owner.

## [HR2] The normal HUD lists the live authored household

The roster reads named agents carrying stable `SimId` values from the live
simulation. It sorts by `SimId`, which is household declaration order, rather
than by render row or current entity index. Objects and unnamed stress agents
never appear.

Each member is a native button with the authored name as visible text and an
`aria-pressed` selected state. Native buttons provide Tab, Enter, Space, focus,
and touch behavior without manufacturing a second keyboard protocol.

Pausing stops simulation time, not household controls. The shell drains staged
commands through the simulation's command-only schedule once per paused frame,
so selection applies without advancing the clock, needs, or autonomous work.
A full staging queue reports a visible selection failure instead of swallowing
the click. Splitting an ordered command stream across paused frames produces
the same saved world as draining it in one batch, and command-only refreshes
preserve the two position samples already being interpolated.

## [HR3] Restore cannot leave stale controls

Buttons are keyed by stable `SimId`. Their click path re-reads the live roster
and resolves that identity to its current entity index immediately before
sending the existing Select command. A loaded world may therefore replace
entity indices without redirecting a previously rendered button at the wrong
person.

The roster refreshes at the authored HUD cadence during play and forces an
immediate reconciliation after a successful manual Load. New Game reloads the
page after clearing storage, so it rebuilds from the fresh simulation.

## Acceptance

1. Empty content and exactly six members compile; seven members fail with the
   count and ceiling in the error.
2. Six compiled members preserve declaration order and spawn with matching
   stable identities.
3. The roster shows every named household member in stable identity order.
4. Pressing a roster button sends Select for that member's current entity.
5. Selection styling is read from simulation state rather than remembered in
   the shell.
6. A world replacement with new entity indices does not make an old button
   select a stale or different entity.
7. Removed members disappear on forced reconciliation.
8. Desktop and narrow-screen checks leave all member buttons readable,
   keyboard-operable, and at least 44 CSS pixels tall.
9. Paused selection applies on the next rendered frame without advancing the
   simulation clock.
10. A rejected Select command produces visible failure feedback.

## Deliberately outside this slice

The roster originally left relationships without a normal-play panel. The
follow-up in `docs/specs/2026-08-01-people-panel-design.md` now merges this
complete household list with sparse relationship pairs by stable `SimId`.
Create-a-sim, birth, death, adding three more shipped characters, and changing
the save schema remain separate decisions.
