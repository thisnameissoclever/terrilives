# Meal-sharing appreciation

Issue 275, owner decision of October 18, 2026: when Bill cooks a meal and Tim eats it, Tim appreciates Bill. Choices marked for confirmation are not owner-approved balance decisions.

## Contents

1. [Trigger and opinion](#ma-trigger-trigger-and-opinion)
2. [Balance and limits](#ma-balance-balance-and-limits)
3. [Determinism and saves](#ma-save-determinism-and-saves)
4. [Verification](#ma-tests-verification)

## [MA-trigger] Trigger and opinion

The final eating step of `eat_shared_meal` completes a claimed, uneaten portion in `SavedDomestic.meals`. That row identifies the cook by permanent `SimId`. Mark the portion eaten and raise only the eater's directional affinity toward that cook. Affinity is the existing opinion score from -1 to 1. The cook's opinion and other diners' opinions do not change from this event.

Cooking, plating, invitations, collecting a plate, gathering and interrupted eating grant nothing. The cook's `cook_dinner` eating step grants no appreciation of themselves. Snacks and eating without a matching cooked-meal record grant nothing. If the cook no longer exists when eating finishes, the portion still counts as eaten but grants no appreciation. Existing opinions of the dead cook remain unchanged. Both autonomous invitations and the table's `take_prepared_food` action reach the same eating completion.

**For confirmation:** reward completed eating rather than its first bite; apply the reward to seated, standing and counter meals equally. Existing eligibility remains: plating invites at most three hungry friends, selected in permanent identity order. No new sharing command or wider invitation policy is added.

## [MA-balance] Balance and limits

**For confirmation:** `meal_appreciation_gain = 0.009`, a root value beside relationship tuning in `content/tuning.toml`. This matches one finished chore's reward for an observer with average cleanliness: `0.006 + 0.006 * 0.5`. A meal helps its eater directly, so the reward does not depend on cleanliness. The live tuning source must provide a finite value from 0 to 1; zero disables appreciation.

**For confirmation:** the reward is small beside seated company. At neutral compatibility, eligible seated diners already gain about `0.0103` opinion per game minute from eating together (`0.062 * 10 / 60`), so `0.009` per meal is barely noticeable at a shared table and stands out mainly for people eating standing or at a counter. It is about 5 percent of one finished conversation's base gain of `0.17`. Compatibility, needs and existing shared-activity eligibility can change that comparison.

**For confirmation:** use the existing `Relationships::bump` clamp at 1, with no separate daily cap. Each eater receives the reward once per cooked batch. The saved `eaten` list prevents duplicate rewards, including after reload. A later cooked batch can reward the same eater again. Abandonment may mark a portion eaten to retire its claim, but does not award appreciation.

Chore appreciation changes the observer's opinion of the actual worker through `Relationships::bump` and records a diagnostic effect. Its size scales with cleanliness; it has no trait, dislike or reciprocal modifier. **For confirmation:** meal appreciation uses the same opinion operation and diagnostics, with its own cause, but no cleanliness, trait, food-quality, dislike or family multiplier. A guest can appreciate a cook whom the guest dislikes; invitations already depend on the cook's opinion of the guest.

## [MA-save] Determinism and saves

No new random draws or streams are needed. Completion follows the existing deterministic chain order; sorted relationship entries and the existing meal identity determine the result. Needs, food quality, dishes, cleanup choices, timing and random generator state retain their existing one-meal results. Changed opinions can affect later social choices normally.

No save field, schema version or compatibility exception is added. `SavedMeal.cook`, `claimed`, `collected` and `eaten` already persist the necessary provenance and completion state. Existing saves with prepared meals acquire appreciation toward a living cook on their next uneaten portion's completion. Already-eaten portions receive no retroactive reward. **For confirmation:** apply these rules immediately to loaded households.

The compiled tuning appends the new value after existing fields. Historical frozen packs reconstruct zero, preserving their behavior; the live shipped tuning alone owns the new balance value. The structural content digest and save manifest should remain unchanged because no action, model, recipe or saved reference changes. Regenerate the inherited runtime pack only through its documented test and prove that its sole encoding difference is the appended tuning value. Classify world-hash movements separately as gameplay effects, never as a save encoding change.

## [MA-tests] Verification

Simulation tests cover the eater's appreciation of the actual living cook, finishing a portion after the cook dies, self exclusion, independent rewards for shared eaters, duplicate completion, snacks and missing meals, pre-eating steps, the existing opinion clamp, a later batch, and the absence of other one-meal state changes. Save continuation tests and historical fixture suites verify existing meal provenance and load compatibility.

See the [dated verification record](../evidence/2026-10-18-meal-appreciation.md) for test names, fixture hashes, checks and review findings.
