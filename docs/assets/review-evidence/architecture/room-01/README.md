# First architecture room evidence

This is the technical room checkpoint for the approved windows, walls and floors plan. All nine window concepts remain approved. The owner accepted candidate08 wall/floor appearance.

The current source fixture is `trial/candidate-08/`: 29 registered color/depth exports, 1024x1252 pixels, with a completed hidden-Blender receipt and source hashes. The production atlas and accepted reference sprites remain byte-identical; see `preserved-source-hashes.json` and `baseline-hashes.json`.

1. `gpu-run-06.json` is the final candidate08 proof: all 32 cases pass. `candidate08-cutaway-1x.png`, `candidate08-cutaway-3x.png` and `candidate08-full-3x.png` are its native, enlarged contact-reference and full-shell views. Owner appearance acceptance is confirmed.
2. `baseline-play.png`, `baseline-full-walls.png` and `baseline-flat-full-walls.png` show the current game before the opt-in renderer additions.
3. `gpu-run-05.json` proves canonical world-grid floor vertices: 12 physical-depth cases and 20 floor cases pass. It uses candidate06 art, before the cap-normal correction. `canonical-captures.json` also records 171 wall-occlusion and 127 cutaway regressions passing after the vertex change.
4. `wall-normal-diagnosis.json` records the independently evaluated top face, incorrect blended corner normals, the rejected distant-light hypothesis and corrected raw source samples on both axes. Candidate08 preserves the original lights and pins cap/side corner normals to their planar face normals.
5. `gpu-run-01.json` through `gpu-run-04.json`, `candidate*.png` and `canonical-*.png` retain earlier review evidence. They are historical candidates; their filenames do not imply owner acceptance. Candidate06 floor coverage failed at two fractional origins before canonical vertices replaced independent fragment predicates.
6. `depth-mutation.json` shows the depth-texture deletion is caught: all 12 depth probes fail while all 20 floor cases still pass. The original shader was restored byte-for-byte; `depth-restored.json` confirms all 32 cases pass again.
7. Browser timing fields average 30 CPU submissions plus GPU completion. Historical-art timings use the same candidate renderer. They measure neither GPU timestamps nor the incremental cost over the original shader.

Run the isolated room with `/proofs/index.html`, then import `/proofs/architecture-room.js` and call `architectureRoomProof({scale:1,show:true,cutaway:true,probes:true})`. Use scale3 for a close view of the unchanged desk and occupied bed, or `cutaway:false` for the complete wall shell. The caller closes its disposable browser context in `finally`; the proof destroys its GPU device and never creates a save.

`original-renderer-overhead.json` addresses the independent review timing requirement. It compares byte-identical historical geometry and equal output pixels under the pinned original renderer and the candidate renderer, with warmup and alternating batches. The paired mean additional time per frame was +0.000281ms at 1x, -0.000628ms at 1.75x and +0.001958ms at 3x. All approximate 95% intervals include zero. This small-scene run found no clear overhead; it establishes neither a performance gain nor a large-scene guarantee. Raw batches, input/source hashes and interval ranges are retained.

`cleanup-fixed-gpu.json` records 32/32 passing room cases after acquisition cleanup was corrected. Timed-out GPU and image acquisitions dispose of results that arrive later; timely resources remain owned by the proof's `finally` block. The benchmark's ignored baseline snapshot is recreated with `python -B web/proofs/prepare-architecture-baseline.py`, then run through `/proofs/architecture-overhead.js` using `architectureOverheadProof()`.
