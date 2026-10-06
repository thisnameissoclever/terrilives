# Chores goal audit

Inspected 2026-10-04 in the attached worktree, based on revision
`8bb83ffb35846e9b4e59bc319937d140dce14bb0` and its local changes. The full goal
includes additional chores, chore tendencies, daily commitments, weekly
assignment and interpersonal consequences. Targeted dishes are its first
milestone.

| Requirement | Current evidence | Finding |
| --- | --- | --- |
| Clicking one visible dish pile cleans that pile | `web/tests/targeted-dishes.test.ts`, native targeted-pile tests and the guarded browser callback | Implemented locally; other piles retain their identities |
| Surface Clean up clears only that surface | Native repeated-trip and scope tests, browser surface-menu and completion guards | Implemented locally, including dishes added during the chore |
| Floors become grimy and need cleaning | `SavedFloors` stores coverings only; the game-system description says floor messes are unbuilt | No grime state, aging, cleaning task or visible grime projection exists |
| More chore types | Authored cleanup chain handles dishes; the trashcan and washing machine are decorative | Additional chores still need implementation |
| Traits alter chore willingness and enjoyment | Domestic cleanliness changes dish-cleanup probability and annoyance; existing activity preferences affect object selection | No independent responsibility value or per-chore enjoyment model exists |
| Weekly automatic assignment using affinity and randomness | No board or assignment records occur in the save envelope or chore scheduler | Not implemented |
| Daily chance to honor commitments | No saved daily duty decisions, completion history or commitment episodes exist | Not implemented |
| Sims recognize assigned owners and react to completion or neglect | Dish annoyance attributes mess to its creator; there is no chore-duty ownership | Creator attribution exists; assigned-duty appreciation and resentment do not |

The [targeted-dish verification](verification.md) establishes its local checks
and browser evidence limits. The branch remains uncommitted and unpublished.
The expanded goal is active; this first milestone does not complete it.

## Next design boundary

Extend the existing domestic work rather than add a competing scheduler.
Represent chore kind, target, assignee, execution and observed outcome separately.
Use stable SimIds for duties and personality values. Keep cleanliness distinct
from responsibility and per-chore preference. Persist daily decisions so reloads
cannot reroll a commitment, and bound interpersonal consequences to one observed
episode rather than charging them every simulation tick.

Floor grime, wiping surfaces and emptying bins provide distinct chores using the
existing house. The automated board follows those chore implementations. The
proposed assignment default uses chore preference; housemate relationships react
to fulfillment or neglect. Whether relationships should also affect assignment
is pending the owner's preference.
