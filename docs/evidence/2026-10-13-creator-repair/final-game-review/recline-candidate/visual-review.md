# Early reclining candidate review

The candidate repairs the original tall-person head/hair clipping at the unchanged sofa placement. A separate bubble clipping defect remains in rotation 2, so this is not an overall visual pass.

1. Rotation 1 replays the exact retained failing save and original camera. Curled hair and the complete activity bubble are now visible. The head anchor moves from y=-0.589608 to y=-0.217051. Bent knees fit the shorter available length; the shoes visibly rest at the sofa end. I found no new visible neck separation, detached resting hands, or gross support gap in the three inspected frames.
2. Rotation 3 uses the same tall, slim body at its original fixture position and camera. Head/hair, neck, resting hands, bent knees, and shoes look coherent in the inspected initial and 18-tick frames. The complete bubble remains visible.
3. Rotation 0 uses the prior short, wide body. The head, torso, hands, and shoes remain visibly supported in the inspected frame. No new defect was identified.
4. Rotation 2 still displays only the left portion of its activity bubble, with a straight vertical cut at the rear wall. The character's head/hair remain visible. Both `recline-2-t0.png` and `recline-2-t18.png` show this. The original `../extra-recline-2-active.png` has the same clipping, so the candidate did not introduce it. My initial contact-sheet review missed the partial bubble because the cut resembled the crop boundary. The full screenshot establishes that it is inside the image and belongs to the rendered scene.

`node scripts/character-creator-repair/final-game-recline-recheck.cjs` exited 0 and captured 12 frames across rotations 1, 3, 0, and 2. `receipt.json` records all character TypeScript/WGSL hashes and the current WebAssembly hash unchanged before/after. All actual actors stayed in `sofa_recline` on sofa 11 during capture. No page errors or graphics diagnostics occurred. The browser context is closed.

This is a screenshot inspection of two configured bodies in four rotations. It is separate from the worker's numerical 64-body-corner fit and does not approve every body, hairstyle, or fixture arrangement. The remaining bubble defect needs a visibility repair and actual replay; moving the sofa is not acceptance evidence.

**Next steps**: Repair the remaining bubble/wall visibility, then replay the unchanged cases. No user action is needed.
