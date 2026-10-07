# Sofa neighbor coupling: fresh approach review

## Real goal

[G1] Three full-size Sims must sit and read naturally on the original three-seat sofa, with supported bodies and hands, intact clothing, and no invalid body, furniture or neighbor intersections. Publication requires the final reading grip, supported directions and mixed actions, followed by the owner's visual review. The present question is how to obtain a credible phase-zero sitting candidate, not whether to change the sofa (`docs/superpowers/plans/2026-10-05-object-models-books-seating.md:16-21`; `sofa-coupled-contact-brief.md:3-19`).

## Diagnosis check

1. [D1] The complete acceptance gate worked. Receipt evaluations 3, 4 and 5 contain 54, 46 and 54 surface triangle pairs between seat 0's `Relaxed shirt sleeve` and seat 1's `Relaxed shirt sleeve.001`. All were rejected; candidate 2 remains selected. I independently checked the receipt SHA256 `da704d0ac97f83560bf765e79c210686f4f03815dc19148eb17c16440fef690b` and selected-geometry SHA256 `aaf6274cdd4b962165ed64a1baf41fca58a4dd7519d1493a8c7b121a7937c539`. Both match. Evidence: `sofa-contact-solver-fit-02/proof.json:250599,314566,378507,397303-397305`; neighbor discovery in `sofa_contact_solver_scene_v2.py:141-148`.

2. [D2] The claimed coupling covers variables within one arm; the search does not couple neighboring arms. `active_rows` requires `row.get('seat') == seat`, while neighbor rows carry `seats`. Neighbor geometry therefore contributes only a rejection after proposing the step. The selector chooses one arm, prioritizes one own-body pair, and differentiates one projected minimum against one direction chosen from the target's principal axes. It applies only that arm's frames. The neighboring right arm is never selected before the stop. This explains why smaller proposals retain the same conflict. Evidence: `sofa_contact_solver_fit_v2.py:36-41,48-69,123-132,152-185,187-208`; `sofa_contact_solver_scene_v2.py:146`.

3. [D3] The blocking material is outside the rigid predictor's scope. I mapped the retained neighbor triangles through the saved evaluated polygons to original source faces, checking that each evaluated triangle had exactly one parent polygon. All three trials implicate seat 0 left-sleeve source faces **34, 35, 58, 59** and seat 1 right-sleeve source faces **48, 71**. Vertices of these source polygons include upper-arm/spine weights ranging from 0.2746295333 to 1.0 on the upper arm and 0 to 0.7253704667 on the spine. This is evidence for evaluating the blended region, not for rebinding it. The existing predictor intentionally selects distal source material and transforms it rigidly by the upper-arm matrix (`sofa_contact_solver_fit_v2.py:50-59`; `sofa_contact_solver_fit.py:125-128`). Source correspondence follows `classify_sofa_lap_contacts.py:25-29`, using `sofa-binding-audit-01/source-binding.npz` and its saved-object group order.

4. [D4] The optimization score can reward worsening another existing garment failure. It sums invalid intersection-segment lengths; it is not penetration depth or distance to a feasible pose (`sofa_contact_solver_evaluator.py:81-85`). Candidate 2's left cuff/shirt residual is 229.274. Candidate 3 clears the sleeve/pocket row but raises cuff/shirt to 280.142 and sleeve/shirt from 804.472 to 822.921. The total nevertheless improves from 1119.767 to 1103.063. Without the new neighbor rejection, the selector's 1% rule would retain that trade. Exact values are in receipt `evaluations[2]` and `evaluations[3]`; acceptance logic is `sofa_contact_solver_fit_v2.py:193-202`. Segment length remains useful evidence, but should not alone choose the direction or certify progress.

5. [D5] The earlier derivative defect is separate and corrected. V2 bounds the common reference and computes responses against actual bounded moves (`sofa_contact_solver_adaptive.py:14-32`); its new placement bounds do not project palm centres onto the thigh triangles (`sofa_contact_solver_domain_v2.py:39-42`). The latest failed updates record zero reference-entry moves. Their repeated predictor direction and neighbor crossing do not justify repeating the old continuity investigation. The existing reconstruction and placement controls remain relevant (`sofa-contact-solver-report.md:31-37`).

6. [D6] No new source defect is demonstrated. The surviving checkpoint has six supported hands and no new fold, joint, furniture or neighbor failure, while the rejected motions introduce a collision between two separately articulated occupants. Source anatomy already explains upper-arm cuffs and spine-bound pockets; shoulder material is blended. Those facts warrant a different coupled pose search. They do not establish a wrong skeleton, wrong binding or impossible sofa. The retained shoulder rule is conservative; its unresolved cases must remain unaccepted, not be silently turned into source defects (`sofa-coupled-contact-report.md:7-11`; `sofa_contact_solver_evaluator.py:50-63`).

## What was taken as fixed but is not

1. [F1] One arm per update and one smallest positive principal-axis separation are implementation choices. Neither comes from the owner's goal. A direction that clears a pocket can consume the neighboring sleeve's remaining space; the next proposal must model that competition before evaluation.

2. [F2] Lower total segment length and no newly named failure are search policies. Already-invalid constraints may worsen under that policy. Track each affected physical constraint, its witnesses and predicted versus measured change; require complete feasibility before calling any pose a survivor.

3. [F3] The hips, feet, outer armrest controls and 17.306-degree lean are useful experimental controls, not permanent owner requirements. The outer placement layer sets 0.52 seat spacing and the torso lean (`probe_sofa_hand_support.py:31-42`). The current evaluator enforces unchanged non-arm geometry (`sofa_contact_solver_scene_v2.py:65-70`). A later body refit must replace that experimental invariant with freshly measured support and waist checks. The present three failures do not yet require that expansion.

4. [F4] The seven-variable domain retains a local hand normal, a shape-derived tilt range and a 0.5 mm minimum-gap construction (`sofa_contact_solver_domain_v2.py:22-30`; `sofa_contact_solver_fit.py:114-123`). These are a local search chart, not an exhaustive description of every supported hand. Keep them for the next discriminating comparison, but do not claim that failure of this chart exhausts the owner's goal.

## Alternative routes

1. [ALT1] Solve the two conflicting arms as one constrained local problem.

   Mechanism: combine seat 0 left and seat 1 right into one 14-variable state. Include their own garment witnesses and the opposing sleeve boundary in the same local model. Use actual evaluated blended geometry for the blocking source faces. Derive local separation constraints from the involved triangle features and source anatomy, with the existing complete gate deciding physical validity. Preserve named constraints independently; use pose departure only to rank feasible results.

   Work required: add a block-frame proposal interface above the unchanged full-frame primitive. Replace single-pair principal-axis descent with a small constrained linear step over both arms. Build the local response matrix from actual evaluated feature motion, retaining support, reach and every nearby collision constraint. Do not use whole-sleeve rigid transforms for the blended source faces or infer closed-shirt containment. Keep the full-scene evaluator and exact memoization. No dependency addition is needed for the interface or bounded proof.

   Costs and risks: two changed arms invalidate more cached entries, and a local model can lose accuracy when contact features change. Such changes require explicit measured relinearization, not repeated step halving. This route still may fail to produce a complete feasible pose.

   Makes easier or harder later: provides a reusable way to group arms connected by active collisions. It preserves current body support evidence and can expand to other neighboring arms when actual witnesses require it. It requires more disciplined constraint diagnostics than the scalar score.

2. [ALT2] Refit supported body placement using final sitting and reading envelopes.

   Mechanism: move shoulders through supported torso and, where necessary, pelvis/leg changes, then fit hands and arms. Choose the three body arrangements together using the final book and grip envelope.

   Work required: replace fixed-body equality with actual hip, sole, waist, furniture and body-clearance verification; recompute contact regions and solve all affected limbs. Preserve original assets, scale and physical seat identities. The final reading envelope is a prerequisite for claiming mixed-action acceptance.

   Costs and risks: reopens substantial verified work, can damage outer armrest reach, and may be premature while the neighboring arm has never been allowed to respond. It requires broader source-preservation and visual evidence.

   Makes easier or harder later: addresses shared body spacing directly and may support reading more naturally. It increases the authoring and verification scope. This is the next architectural expansion if a properly coupled local comparison identifies body-placement limits; it is not currently demanded by the evidence.

3. [ALT3] Investigate and repair a demonstrated articulation defect in a separate derivative.

   Mechanism: first isolate incorrect source ownership or deformation under an independently justified motion, then repair only that demonstrated binding problem while preserving original bytes.

   Work required: identify the exact material region, intended bone influence, neutral correspondence and deformation defect; demonstrate that a proposed derivative repairs it across relevant motions. A lower collision count in this one scene is insufficient.

   Costs and risks: no present witness establishes such a defect. Moving sleeve weights to protect an arbitrary fit would be a pose-specific alteration disguised as repair.

   Makes easier or harder later: a proved defect repair would benefit all poses; an unsupported one would add regressions and conceal the arrangement problem. This route remains conditional.

## Recommendation

[R1] Choose [ALT1], the two-arm constrained local solve. It changes the smallest architectural boundary that the evidence identifies: proposal generation currently ignores the movable neighboring blocker. Preserve the original sources, derived waist binding, support construction and seated bodies for this comparison. Model both implicated blended sleeve regions and all affected own-body constraints before proposing motion. Do not resume the rejected principal-axis ray at another step size. Reopen body placement only with explicit limiting witnesses from this coupled comparison; no owner clarification is needed within the existing immutable-source scope.

1. [P1] Establish one exact common checkpoint from candidate 2. Reconstruct both arm parameter states and verify complete matrices. If the support construction changes an untouched arm, label and fully evaluate the result as a new reference; stop if it introduces a new hard failure. Never compute derivatives against a different reference. Preserve the 1e-5 frame/reach/joint bounds, source-rest controls, support exposure and full scene gate.

2. [P2] Use the exact retained witnesses. The neighbor arrays are `candidate/neighbor/0/1/Relaxed shirt sleeve/Relaxed shirt sleeve.001` in `candidate-003.npz`, `candidate-004.npz` and `candidate-005.npz`. Their source-face sets are recorded in [D3], the blended-neighbor diagnosis. Candidate 3 begins with evaluated triangle pair `(1901, 2296)`; candidate 4 begins `(1898, 2296)`. Keep all pairs, not just these examples. Own-body rows use `candidate/mapped/0/Relaxed shirt sleeve/One sewn breast pocket`, `candidate/mapped/0/Relaxed shirt sleeve/Overshirt body`, `candidate/mapped/0/Turned sleeve cuff/Overshirt body`, and `candidate/mapped/1/Relaxed shirt sleeve.001/Overshirt body`. Read their `source_segments`, `source_faces` and invalid segment indices. Reuse the existing anatomy mapping and attachment controls; this review did not recalculate intersections.

3. [P3] Propose one bounded causal comparison, not a production fit marathon: at most **18 complete scene evaluations and 1,200 seconds**, stopping at whichever limit arrives first. Reserve one common-reference replay, up to fourteen admissible one-coordinate diagnostic perturbations, and three comparisons using the resulting joint step: left arm alone, center-right arm alone, both together. These perturbations estimate local response; they are not an angle grid or accepted poses. Count every full evaluation, including rejected probes. Pure reach failures cannot silently create extra geometry budget. This is a proposed parent-granted window, not authorization to launch now. Plan two Blender threads; changed-two-arm timing and memory remain unmeasured, so reduce the count if measured costs threaten the wall bound.

4. [P4] A useful result demonstrates that the joint change improves the targeted garment geometry while preserving neighbor separation and every previously valid gate, with neither arm's existing invalid garment constraints silently worsened. Compare source-feature displacement, local separation predictions and measured intersections for all three comparisons. A joint improvement that the isolated changes cannot achieve supports the coupling diagnosis. An isolated improvement can instead show that a better constrained direction was sufficient. Neither result accepts a pose with remaining failures. If the local model predicts feasibility but actual geometry contradicts it, stop and report the exact blended/contact feature mismatch. If the local system has no admissible improving step, report its rank and conflicting constraints; that is a local limitation, not a global impossibility proof.

5. [P5] Reuse verified full-rest frames, exact unchanged-pair caching, source topology and attachment classifiers, continuous support, existing negative controls and immutable receipts. Re-prove actual replay, changed-arm folds, all own-body/furniture/neighbor checks, all six support areas and exposure, joints, source hashes and the complete gate for every candidate. A new local predictor also needs prediction-versus-evaluation evidence on the implicated blended faces. These proofs cannot be borrowed from unchanged-scene cache timing.

6. [P6] Only a complete phase-zero survivor earns opposing diagnostics and a whole-sofa view. Parent review of comfort and plausibility precedes phase expansion. Then verify all four shared phases, final canonical reading and mixed actions, supported directions, and the production/export phase contract. The owner's publication review remains a separate final gate. No pose, image, binding repair or publication is approved by this document.

## What I could not determine

1. [U1] I did not run Blender, renders, tests, builds or a new fit. This review inspected immutable receipts, source and cached arrays, rehashed the two requested artifacts, and mapped retained triangle ownership without recomputing intersections. It proves the specific search limitation, not existence of a feasible pose.

2. [U2] No final canonical reading envelope or actual mixed-action renderer replay was available within this review. The current sofa report explicitly retains those dependencies (`sofa-contact-solver-report.md:53`). A phase-zero sitting improvement cannot settle them.

3. [U3] I cannot yet distinguish a two-arm solution from a need to adjust supported body placement. The bounded comparison above is intended to supply that evidence. Nothing inspected establishes a new articulation defect.

**Next steps**: Parent implements and reviews the two-arm proposal model, then grants a bounded geometry window if its checkpoint and witness controls are ready. No owner answer is needed for that scoped work.
