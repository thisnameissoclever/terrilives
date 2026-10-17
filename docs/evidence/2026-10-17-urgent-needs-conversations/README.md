# Urgent needs and pending conversations: verification record

This record covers the urgent-needs and conversation changes developed on `twcx/urgent-needs-conversations` on October 17, 2026. The implementation checkpoint is `5107826ba`; `7c5f759a5` integrates main through `94a0e6618`. Final automated results and deployment evidence belong with the final inspected revision below.

## Reproduction and repaired behavior

The original selector allowed a conversation which later social maintenance canceled when either participant's Hunger, Energy, or Bladder was at or below 20. Movement had already advanced. The next update could choose the same conversation, producing repeated quarter-tile reversals with an idle body pose. The generic activity label concealed that cancellation loop.

The displayed published baseline reproduced the defect with an equivalent V14 seed-42 fixture. At normal speed, thirty samples showed Tim alternating between x=8.75 and x=9.00, y=2, with the idle clip and the deciding label. See [baseline samples](baseline-browser-samples.json) and [the defective rendered frame](capture-a-10.png).

The repaired build progressed from walking to talking. See [fixed samples](fixed-browser-samples.json), [approach](capture-b-early.png), and [conversation](capture-b-15.png). A separate care fixture demonstrated Bill using the toilet while Tim waited outside. At tick 54 the label read `Waiting outside to talk to Bill`; at tick 80 both people were talking and Bill's Bladder had recovered to about 68.5. See [care measurements](care-transition-proof.json) and [private-use frame](care-private-active.png).

Waiting remains a chosen commitment. Tim's Hunger fell during that wait; the change does not freeze needs or guarantee survival. Unreachable facilities, mandatory work, and a long chosen conversation can still delay care.

## Displayed review conditions

The local Windows desktop ran a real displayed Chromium browser with isolated storage, protecting the owner's saves. Desktop review used 1280 by 900 pixels. Phone review used 390 by 844 pixels with reduced motion enabled. The game was played at normal and triple speed, with pause/resume checks. Task-owned pages, contexts, browser, and preview server were closed after review.

The phone's initial status truncated the partner's name. The repaired layout wraps the full named wait and keeps the queue readable without horizontal page overflow. Compare [rejected phone layout](mobile-condition-c.png) with [accepted phone layout](mobile-condition-d.png). The [settled conversation frame](care-talk-mobile.png) and [state proof](settled-mobile-proof.json) show both talking clips and the Talking label after the interface refresh.

Creator review sampled twenty-four random values within 11 through 95, preserved a locked manual zero, and committed both manual endpoints. The number control and slider agreed at 0 and 100; Undo restored 0. See [committed-control measurements](creator-committed-proof.json), [zero](creator-manual-0.png), and [one hundred](creator-manual-100.png). Exact probability and boundary tests provide the distribution proof; a small visual sample does not.

A fresh independent visual reviewer rejected the known defective motion and clipped phone status before accepting the repaired states. The reviewer also rejected an uncommitted creator input and a conversation capture taken before its label refreshed. The replacement captures above resolve both ambiguities. Selected stills establish the reviewed states; they do not establish every frame of a walking stride. Bathroom geometry obscures part of the waiting body in some frames.

[Reviewed artifact hashes](reviewed-artifacts.json) identify this visual build. It predates the final shared physical-prediction refinements and main integration. Those refinements preserve reward delivery arithmetic but change how autonomy estimates attainable relief. Final rebuilt and deployed verification must be reported separately rather than attributed to these earlier captures.

## Regression and review evidence

Executable regressions reproduced lost critical-initiator commitments, missing waiting activity, removal of a later identical player order, premature unreachable reservations, lost paused-load wait reasons, and mismatched physical relief. The five final physical/save regressions passed after repairs: terminal meal timing after zero-clamped Hunger, reading disposition, media company scaling, passive-listener remaining duration, and rejection of contradictory V15 ownership.

A later fresh source review found two further defects: reading could classify one plan and execute another, and malformed V15 records could share a physical conversation participant. Both failures were reproduced before repair. Critical reading now samples concrete plans in the outer grouped draw and executes the selected plan; V15 validates both participants of admitted pairs. The reviewer found no further actionable defect in those repairs. An independent scalar comparison checked the bounded constant-phase forecast against tick-by-tick delivery across floor and restoration-cap crossings. Native coverage also retains a scalar reference test for those cases.

Current random creation intentionally changes the new-world random sequence and gives public native/WebAssembly spawns stable Sim IDs. Native and release WebAssembly independently measured the same current scenario hash, `4676206450852028819`, before the final listener-delay refinement; see [the runtime measurement](wasm-current-golden.json). Historical byte fixtures and their readers remain frozen. Existing saved self-preservation values and historical missing-value migration retain their old behavior.

Detailed local command logs and temporary fixtures are kept in ignored `.superpowers/sdd/2026-10-17-urgent-needs-and-pending-conversations/`. No review video or bulk frame sequence is published.

The trace's conversation completions are inferred from disappearance after a remaining countdown of one. Its meter-rise counters observe recovery without attributing every increase to a particular choice. These aggregates describe behavior; exact order ownership, cancellation rules, and predicted-versus-executed rewards are established by their deterministic regression fixtures. A trace disappearance alone does not establish why a request ended.
