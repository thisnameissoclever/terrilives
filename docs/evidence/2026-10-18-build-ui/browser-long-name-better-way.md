# Long-name dock verification review

## Real goal

[G1] Players should get shorter dock controls with the requested widths and fonts preserved, readable full activity text when disclosed, and the requested Build behavior. Gameplay renaming is optional stress setup; proving the character editor is outside this requested change.

## Diagnosis check

[D1] Confirmed: direct label replacement and cloned roster buttons cannot establish a real long-name household. The roster reads names from the source (`web/src/ui/household-roster.ts:48`), retains its own button objects, rewrites their text, and restores their DOM order (`web/src/ui/household-roster.ts:129-149`). Replacing their text loses to the next refresh. Removing them and adding clones causes the retained originals to be inserted beside the clones. The retained receipts show Tim/Bill/Casey plus three cloned labels (`receipts.json:2507`, `receipts.json:2693`); this is a contaminated control, not gameplay evidence. The report rejects those captures (`report.md:23`).

[D2] Refuted: a filled Name field proves the draft accepted the name. The Name field is text with the catalog limit (`web/src/character/fields.ts:68`). Text controls commit on `change`, not `input` (`web/src/ui/character-creator/field.ts:63-64`). A successful commit calls `draft.set` and then the view callback (`web/src/ui/character-creator/field.ts:19`); the callback synchronizes status (`web/src/ui/character-creator/view.ts:223-228`). Undo and the preview heading read draft state (`web/src/ui/character-creator/view.ts:110-115`), and Review also reads draft state (`web/src/ui/character-creator/view.ts:257-265`). Input value alone is the weakest observable in this path.

[D3] The attempted stress name is invalid under the current source contract. `Alexandria Longhouse-Witham` has 27 characters; `content/tuning.toml:196` permits 24. The exact 27-character field value and disabled Undo are recorded at `receipts.json:3458-3466`. The text input sets `maxLength` (`web/src/ui/character-creator/field.ts:63`); draft validation independently rejects an over-limit changed name (`web/src/character/validate.ts:8`). The draft transaction restores its checkpoint on rejection and creates the Undo checkpoint only after validation succeeds (`web/src/character/draft.ts:86-94`). Therefore Tim plus disabled Undo is compatible with a missing commit event or a rejected commit. The receipts do not distinguish those causes. They do not reproduce a broken valid-name edit.

[D4] A rejection should be visible through the existing error path: the field callback rebuilds and calls `fail` on exception (`web/src/ui/character-creator/field.ts:19`); `fail` writes the error to `.creator-status` (`web/src/ui/character-creator/view.ts:89`, `web/src/ui/character-creator/view.ts:111`). The failed attempt did not retain the Name field's `maxLength`, focused element, change-event receipt, or creator status text. Without those observations, blaming either native blur or validation as the exact observed cause would overstate the evidence.

[D5] Source tests support the model boundary but cannot fill this browser gap. `web/tests/character-draft.test.ts:34-37` checks that a valid renamed draft produces a name-only patch. `web/tests/character-draft.test.ts:51-55` checks atomic rejection and Undo. `web/tests/creator-view.test.ts:115-119` sets the draft directly and checks appearance redraw behavior. The field-control fixture invokes registered handlers explicitly (`web/tests/creator-field-control.test.ts:8-16`); its text-control test covers Random and Lock (`web/tests/creator-field-control.test.ts:25-30`). None of those cited tests proves this browser provider delivered a native text `change`. This review read tests and did not execute them.

## What was taken as fixed but is not

[F1] A long gameplay name is not a prerequisite for measuring the requested normal dock control heights. The accepted report records normal-name heights, preserved fonts/widths, coarse-pointer measurements, enlarged text, and actual long activity text (`report.md:9`, `report.md:16`). Those cases remain separate from the unverified long-name case. Bounded completion does not repair a rename defect or certify every legal name; neither has been established here.

[F2] The stress string does not need to exceed the game's legal name domain. A valid 24-character candidate is `Alexandria Longhouse-Wid`. The name domain comes from content and catalog validation, not the dock. Changing name limits or editor events to make this verification setup succeed would be an unrelated product change.

[F3] A DOM layout measurement and an end-to-end rename are different contracts. Dock CSS owns button dimensions and overflow (`web/src/ui/compact-hud.css:94-95`, `web/src/ui/compact-hud.css:131`, `web/src/ui/compact-hud.css:151-154`, `web/src/ui/compact-hud.css:250-254`, `web/src/ui/compact-hud.css:279-282`). The creator owns draft validation; its session then queues a patch and waits for an accepted command result (`web/src/ui/character-creator/session.ts:31-51`). Moving between these layers without checking the draft caused the attempted stress setup to consume unrelated editor and browser-input work.

## Alternative routes

[ALT1] Complete the requested dock verification with an explicit coverage boundary.

Mechanism: Retain actual normal-name measurements, displayed captures, enlarged-text controls, and actual long activity behavior. Keep long-name gameplay layout explicitly unverified, as already stated in `report.md:22-23`. Apply the project's independent visual review requirement to the accepted captures (`docs/testing-protocol.md:232`).

Work required: Reconcile the final evidence summary and obtain the remaining independent visual judgment. No additional rename attempt.

Costs and risks: Legal long names can affect wrapping, horizontal scrolling, truncation, or intrinsic height; this route makes no claim about those states. Enlarged text exercises constrained space but is not equivalent to a long-name household. Normal-name evidence alone also does not settle whether every requested percentage reduction was achieved; use the existing actual before/after measurements for that decision.

Makes easier or harder later: Finishes the requested evidence without coupling it to character editing. A future long-name regression still needs its own real state or a controlled component test.

[ALT2] Authorize one valid native typing control with model checks before Apply.

Mechanism: Use the supported public editor once, on the existing recovered input path, with a legal name. This would test a different hypothesis from filling an invalid value: whether supported sequential typing followed by native focus movement commits a valid draft.

Work required: The tab owner opens Edit, then Identity if necessary; reads the Name input's value, `maxLength`, enabled state, and creator status; clicks Name; uses documented locator `press('Control+A')`, `pressSequentially('Alexandria Longhouse-Wid')`, and `press('Tab')`. Require all of: exact input value, Undo enabled, preview heading equal to that name, and no creator error. Navigate to Review and require its Identity Name to match. Only then activate Apply changes and require the real selected heading and roster member to match after a settled refresh. Capture that actual state in the task-owned disposable session and close the task page without saving the renamed household.

Costs and risks: This is one proposed control, not permission to run it. If the input `maxLength` is incompatible, a documented typing operation is unavailable, any model signal fails, an error appears, or Apply does not produce the real name, stop immediately. Cancel while the editor remains open, retain the exact state/status evidence, and do not substitute another string, event method, tab, clone, private-state edit, or retry. A failure establishes only the boundary it actually reached. Do not patch the editor without a reproduced valid-input defect.

Makes easier or harder later: Can provide real long-name coverage and isolate input delivery from draft validation. It adds an optional editor path and requires careful cleanup. It is unnecessary for the requested normal-name height proof.

[ALT3] Build a reusable dock component layout test in separately authorized work.

Mechanism: Mount the production dock markup, CSS, and roster surface in an isolated test page. Feed public roster data through the real surface's `render` interface with stable SimIds and legal name lengths. Retain one owner of the DOM. Use this for controlled geometry and visual regression evidence, separate from gameplay rename acceptance.

Work required: Add a reusable fixture, matching viewport/font/pointer cases, and assertions that detect clipping, wrapping, focus visibility, and changed actual heights. Add a deliberately defective control to prove the relevant visual assertion rejects it. No fixture or test mutation was performed by this review.

Costs and risks: More work than this optional check merits. A component harness can drift from the application shell unless it reuses production markup and CSS. It does not prove command application or a native editor input path.

Makes easier or harder later: Makes name-length and roster-size matrices repeatable without browser-provider typing setup. End-to-end character editing still needs separate coverage.

## Recommendation

[R1] Take [ALT1] Complete the requested dock verification with an explicit coverage boundary. The repeated failures arose from invalid evidence setup: renderer-owned labels were overwritten, clones conflicted with retained nodes, and the attempted editor name exceeded the legal limit while draft acceptance was never established. No product defect has been demonstrated. The actual normal-name dimensions, enlarged-text cases, and real activity cases address the requested changes; finish their independent review and report long-name gameplay as unverified. If the root judges long-name coverage necessary, [ALT2] One valid native typing control is the only justified further attempt, with its stated stop criteria. [ALT3] Reusable dock component layout testing belongs to future test infrastructure work, not this delivery's acceptance improvisation.

## What I could not determine

[U1] I cannot determine whether a native `change` reached the failed Name field or whether validation rejected that value. Retained active-element, input-limit, event, and status evidence would settle the distinction. Source contract alone does not prove the running build's catalog bytes.

[U2] I did not operate a browser, reproduce gameplay, inspect the accepted screenshot pixels, or approve the overall Build/UI changes. I did not change source, tests, dependencies, servers, browser state, the index, or refs. This report is the only written artifact.

[U3] The separate unsupported touch/repeat input incident is outside this review; `input-better-way.md` remains its record. No additional raw input or emulation experiment is proposed here.

**Next steps**: The root agent should adopt [R1] Recommendation and finish review of accepted evidence. Execute [ALT2] One valid native typing control only if explicitly chosen; otherwise leave long-name gameplay unverified.
