# Open-book grip: fresh approach review

## Real goal

[G1] A seated Sim should visibly hold and read an open book with plausible support, intact arms, and usable motion. Preserve the original mesh, skeleton, scale, materials and source bytes; create any proposed pose or clip as a separately reviewed derivative. The cached survivor warrants one diagnostic replay, not acceptance or another parameter search.

## Diagnosis check

[D1] The original grip already penetrates the book. The saved action and source generator both report 514/528/514/505 crossing pairs at phases 0/.25/.5/.75 in `sofa-original-grip-01/proof.json`; their book-relative geometry agrees exactly. The producer independently evaluates saved and generated poses in `compare_original_read_grip.py:148-157` and compares their geometry at `:193-201`. Restoring lost export roll alone cannot repair the original grip.

[D2] The hand-first construction introduced an elbow frame defect. `sofa_arm_frame_math.py:63-68` independently takes the upper-arm reference from the spine and the forearm reference from the hand, then swings each toward the solved endpoints. That satisfies endpoints without reconciling axial rotation at the elbow. `book_grip_roll_diagnose.py:25-34` removes the required bend before measuring residual rotation. Its receipt reports 179.979/178.855 degrees of residual axial disagreement at phase zero, while `book-grip-diagnosis-01/proof.json:70-145` reports 316/303 forearm self-crossings and zero hand-bone weight on all 48 implicated control vertices per side. This supports a proximal pose-frame diagnosis. It does not demonstrate defective weights, nor does the ideal equal-blend formula describe the actual control transforms: their minimum singular values are approximately .985/.987.

[D3] The next two constructions failed their actual geometry constraints. `book_grip_book_only.py:43-64` centers the prop over palm means and solves roll/height; the receipt still records thumb penetration up to 8.499 mm. `book_grip_edge_fit.py:43-67` uses a weighted vertex objective, local least-squares and exploration bounds; finite support at its output does not overcome the retained 8.352 mm penetration. Neither failure establishes that all rigid prop placements are impossible. Further offset or optimizer-weight variants would repeat the same inadequate construction strategy.

[D4] The survivor uses a materially different, measured construction. `book_grip_pitched_edge.py:36-57` fixes source phase .75, compares complete palm/thumb support envelopes, solves simultaneous cover support, and derives translation from three plane equations. It then checks finite surface overlap and body triangles against book solids at `:65-80`. Linear projection extrema over piecewise-planar triangles occur at vertices, so using all evaluated vertices for these envelopes is valid. The resulting 45.281-degree pitch and 3.793-degree roll are construction results, not anatomical limits or aesthetic approval. The bracketed root is a root of this chosen family; the code does not prove that it is the globally first feasible pitch or the only possible grip. Preserving this result does not require making either claim.

[D5] The collision screen is strong within its stated domain, but its scope must remain exact. `book_grip_pitched_edge.py:17-31` uses the triangle/box separating axes, including face-crossing cases with no contained vertices. It shrinks each box by one micrometre, so zero means no triangle intersects that interior, not mathematically zero penetration at any depth. `book_grip_controls.py:53-65` checks closed box topology, fitted corners, and possible whole-box containment in each body part's bounds. The receipt reports less than five nanometres of corner error and no possible containment. These controls support using boxes for the four covers/pages without requiring closed body meshes. The handoff's generic claim about a margin control is broader than the actual probes: `:25-34` covers crossing, containment, separation, exact touch and one rigid transform; it does not bracket shallow penetrations on both sides of one micrometre. Retain the existing margin and describe it accurately.

[D6] The four-solid check does not cover every rendered book component. `assets/models/sims/sim-01/build_rig.py:140-159` creates ten separate printed-line cubes as well as covers/pages, all rigidly bound to the book bone. The candidate moves those lines at `book_grip_pitched_edge.py:63`, but its collision loop selects only covers/pages at `:72`. The lines are not proved enclosed by the tested solids. This is a specific completeness gap, not evidence that they currently collide. Include them in the actual replay's rendered-prop clearance audit, or establish their containment/separation explicitly before claiming full book clearance.

[D7] Finite contact is established as a geometric proximity band. `continuous_support_patch.py:73-99` clips facing triangle overlap to nonnegative gaps no larger than 1.5 mm, excludes cells hidden by another eligible surface, and sums the retained projected areas. `book-grip-pitched-edge-01/proof.json:37-65` reports 286.603/356.002 square mm with roughly 20 mm spans and no excluded cells. This is better evidence than a hull of near vertices. It does not prove pressure, a frictional grip, connectivity of the union, or visibility from a camera. The construction intentionally leaves the closest palm point 0.5 mm below its cover. The thumbs are wholly below the support planes; no thumb clamp has been demonstrated. Inspect both contact regions, thumb placement and visible gaps in opposing views. Do not reinterpret this receipt as proof that the book is mechanically clamped.

[D8] The load-balance receipt is a conditional concern, not a rejection rule. `book_grip_support_balance.py:13-31` projects the near-contact regions onto the cover planes, forms a horizontal hull, and tests a centroid based on uniform parts and chosen pair masses. Under vertical resultants without stabilizing tangential force couples, its 3.090 mm outside distance rejects that assumed free-resting equilibrium. The recorded admissible page-mass fraction ends near .186, but neither actual masses nor force limits are authored. Moreover, near-contact cells are not actual force-bearing points in a rigid-body model. Do not claim static balance from these areas, and do not invent friction to dismiss the concern. The next useful evidence is whether the actual pose visibly provides convincing support; if a mechanical claim becomes necessary, specify real contact locations, gravity in the transferred frame and a justified force model first.

[D9] Cached correspondence is exact to the selected cache, with a provenance gap to close on replay. `book_grip_controls.py:38-48` recomputes all 54 visible body meshes in source-book coordinates and records bit-identical points and equal triangle arrays. Its receipt confirms all topology comparisons and unchanged input hashes. I independently read and rehashed its input paths without finding a mismatch. The selected cache is `book-grip-verify-01/case-06.npz`. However, `book_grip_verify.py:27-32` merges inherited inputs with its supplied source path; its receipt includes both the original and a derived binding file and does not retain the actual source argument separately. Equality to that cache alone is not an independent proof of full-body equality to the original file. The next replay should explicitly record the opened original path/hash, selected action/frame, rest identity and evaluated source control. Do not silently use the old `canonical-reading.blend`, which `book_grip_verify.py:93-106` saves after applying the rejected hand-first construction.

## What was taken as fixed but is not

[F1] Original book orientation, palm-centred placement and the first palm-face choice were probe decisions. The actual preserved objects can receive a new rigid pose. Moving the book to eliminate its measured original penetration addresses the prop-placement defect directly. It does not repair the rejected arm solver, which must remain excluded from this new contract.

[F2] The exact old reading phases are not a required animation. `assets/models/sims/sim-01/build_rig.py:299-306` independently varies the two wrists with different vertical amplitudes while the book remains separately posed. A derived clip may instead preserve the accepted hand/book relationship through coherent upper-body motion. Phase .75 is a defensible diagnostic seed because the recorded nonadjacent internal arm crossings are zero. It is not a certified natural pose or a whole-body collision certificate.

[F3] Contact preservation belongs at the complete assembly level. `book_grip_controls.py:66-70` stores all source frames and replaces the book frame with `B_source @ correction`. In rig coordinates, a common rigid transform `T` should produce `T @ B_candidate` and `T @ H_source` for each hand, preserving their relative matrices. `build_rig.py:153` supports this treatment for the prop's single-bone binding. A common transform preserves a skinned surface only where every influencing deformation receives it consistently. The waist, hip/spine blends, garments, unmoved lower body and furniture need fresh evaluation; transforming selected bone frames does not prove that the entire evaluated upper body moved rigidly.

## Alternative routes

[ALT1] Replay the measured prop placement, then author a coherent derivative clip.

Mechanism: retain phase .75's arm/hand frames, replay the frozen book correction, and preserve the resulting assembly with common upper-body motion.

Work required: one explicit original-source Blender replay, evaluated correspondence/contact/clearance audit, and opposing grip plus native-size views. Only after the static grip survives should a new clip and furniture integration be authored.

Costs and risks: the grip may look precarious despite finite proximity areas; waist and furniture contacts remain open. This route does not repair the separate rejected solver.

Makes easier or harder later: it creates one reusable grip contract rather than hand offsets per seat, but independent wrist animation must either preserve that contract or be solved as a new contact problem.

[ALT2] Replace independent arm-roll construction with a coupled articulation solve.

Mechanism: jointly solve shoulder, elbow, wrist and book frames, using the source deformation frames to retain a continuous roll branch while enforcing finite support and complete thumb clearance.

Work required: replace the independent references in `sofa_arm_frame_math.py:63-68`; retain source-indexed surface witnesses, complete rest matrices and segment lengths; evaluate both joins and all affected surfaces. Numerical angle limits alone cannot certify the skin.

Costs and risks: more variables and branch handling; actual skin evaluation remains necessary. No weight change is justified by current evidence.

Makes easier or harder later: it permits deliberate arm motion and broader grip variation, at the cost of a reusable articulation solver and substantially more proof than the current static candidate needs.

[ALT3] Author a lap-supported reading arrangement from body support surfaces.

Mechanism: place the book on measured lap/thigh support and position both original hands as stabilizing contacts, solving their frames together if required.

Work required: derive finite lap/book and hand/book patches, check thigh/garment/forearm clearance, and show that the page angle and gaze still read naturally.

Costs and risks: this changes the visible reading composition and may restrict seated postures; it cannot be counted as satisfying the intended hands-held composition without owner review. It is a measured alternative if the current grip visibly lacks support, not a way to waive that failure.

Makes easier or harder later: broad lap support can make visible load support clearer, but binds the pose more closely to seat height and lower-body posture.

## Recommendation

[R1] Take [ALT1], the measured prop-placement replay. The source arms are retained, the complete thumb envelope determines placement, and finite cover support survives a triangle/solid check that catches the previous penetration class. That evidence earns a bounded diagnostic replay. It does not earn publication, a mechanical equilibrium claim, or furniture integration. Repairing the rejected arm solver now would solve a larger problem before learning whether it is necessary. If the replay fails, preserve its witnesses and select [ALT2], the coupled articulation solve, for a demonstrated articulation or grasp requirement; consider [ALT3], the lap-supported arrangement, only for a deliberate composition change.

[R2] Use these acceptance controls in order:

1. Record the original file path/hash, action and phase, complete rest state, matrices, visibility and evaluated baseline. Apply only the frozen book correction in a new scratch output. Reopen/evaluate the saved derivative and compare actual body and prop surfaces to the cached construction, recording residuals against existing tolerances. Preserve original bytes and actions.
2. On the actual evaluated result, retain bilateral finite contact polygons, depths and triangle witnesses; check all rendered book components against the body, both arm interiors, and arm/body/garment contacts. Classify inherited attachments through source regions rather than exempting pair names. Do not make the one-micrometre interior margin larger. Close the printed-line scope gap identified in [D6], the omitted rendered book components.
3. Render opposing close views that expose both palm/cover interfaces, thumbs, wrists and elbows, plus front/side context showing the face and pages. Include native game-size views with production-facing conventions. Require a supported-looking book, readable pose, plausible wrist/forearm shape, and no visible floating or interpenetration. Front-side eye centroids alone do not prove gaze alignment or page visibility.
4. If the static candidate survives, author the derivative motion from that grip. Check every exported pose and loop boundary; if bone interpolation is used, inspect between keys as well. Verify the relative hand/book frames remain fixed where intended, the influencing bone sets move coherently, and no waist/garment folds appear. A rigid upper assembly preserves its internal contact but does not preserve balance relative to gravity or clearance from unmoved surroundings.
5. Then evaluate furniture support, all relevant facings and mixed neighbors, including independently phased adjacent occupants where runtime permits them. Produce complete visuals for owner approval before publication. Do not treat synchronized four-phase samples as coverage of independent neighbor phases.

## What I could not determine

[U1] No Blender, rendering, suite execution, production edits or additional agents were used in this review. I inspected producer code, receipts, repository guidance and input hashes. I did not rerun the collision or contact algorithms. The cached survivor has no actual replay or visual acceptance here.

[U2] Actual naturalness, gaze, contact visibility, static force balance, animation, waist/garment classification and furniture fit remain unverified. The staged evidence in [R2], the replay and visual acceptance controls, resolves the immediate uncertainties without guessing new offsets, weakening tolerances or altering weights.

**Next steps**: The parent can perform the single diagnostic replay and opposing views described in [R2], the replay and visual acceptance controls. No owner decision is needed for that diagnostic step; owner approval remains required before publication.
