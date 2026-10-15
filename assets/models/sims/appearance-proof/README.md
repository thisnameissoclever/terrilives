# Character appearance proof

This development-only candidate exports the accepted Blender character into a browser mesh renderer. It is not the production character creator. The measured results, accepted seating placement and owner-approved cushion/arm intersections are in [the evidence report](../../../../docs/evidence/2026-10-12-character-appearance/report.md).

The source character and production sprite atlas stay unchanged. `baseline-hashes.json` records the protected inputs. `export-v2/` contains the current runtime asset; `export/` retains evidence from the rejected deformation order.

## Reproduce the proof

Run commands from the repository root. Use the existing locked dependencies and installed Blender; do not add packages to reproduce this proof.

1. Build the generated browser simulation with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`. The bridge tests require the release build.
2. From `web/`, start the isolated page with `npm exec -- vite --host 127.0.0.1 --port 5187 --strictPort --mode development`.
3. Open `http://127.0.0.1:5187/proofs/character-appearance.html`. Add `?baseline` for the source material checkpoint and `&original` for the unsimplified source mesh.
4. Run `python -B -m unittest discover -s assets/models/sims/appearance-proof -p "test_*.py" -v`.
5. Run `npm --prefix web test -- --maxWorkers=1 character-`.
6. Run `node assets/models/sims/appearance-proof/verify-browser.cjs`. Set `PLAYWRIGHT_MODULE` to an existing Playwright module path if the desktop runtime is elsewhere. `--quick` skips the full capture and performance sweep.
7. Run `node assets/models/sims/appearance-proof/capture_baseline.cjs` to capture original and simplified source geometry in all four facings.
8. Stop the task-owned server after verification. Both browser scripts close their own browser in a `finally` block.

Run `node assets/models/sims/appearance-proof/verify_motion.cjs` for full walking, reading and transition samples, world-depth picking and renderer/compositor/picker cleanup. The transition studies are **Standing with book**, **Sit down**, **Read** and **Stand up**; time clamps at transition endpoints. These studies do not implement gameplay navigation to the chair.

Choose **Simulation walking** or **Simulation reading** to consume actual simulation positions, facing and ticks. These studies own temporary worlds and leave the appearance-randomness sentinel and player saves untouched. Reading starts from a valid authored household with a real owned book and a legally placed chair. The world camera moves to the study location; the furniture stays at its simulation position. Manual reading playback uses the same authored cadence. Run `node assets/models/sims/appearance-proof/verify_simulation_studies.cjs` to check both presets and all four directions, including pause, randomization isolation, person position and camera restoration after benchmarking.

Outline draws combine only adjacent authored index spans. Run `node assets/models/sims/appearance-proof/verify_outline_batching.cjs` for an exact pixel comparison with individual draws. `profile_submission.cjs` records sequential timing observations for both modes, including CPU submission and completion-wait measurements; neither measurement is an isolated GPU timestamp.

Run `node assets/models/sims/appearance-proof/verify_invalid_storage.cjs` to check invalid saved records and explicit recovery. Only an absent storage key creates a new randomized draft. An empty or malformed stored record remains intact and displays an error until **New random draft** is explicitly selected. Recovery clears source comparison mode while preserving unrelated URL parameters.

To rebuild assets, launch `export_bundle.py` through the existing background Blender launcher with factory startup, automatic scripts disabled, two threads and a Python error exit code. The launcher detaches; inspect `export-v2/status.json` and wait for the Blender process to finish. A successful launcher call alone does not establish a successful export. The exporter never saves the source `.blend`.

Run the contact-witness web test before launching `check_contacts.py` through the same Blender launcher. The checker rejects stale witnesses using source and asset hashes. `state: complete` means the diagnostic finished. Its zero-intersection result remains a geometric measurement; the separate owner acceptance record approves the demonstrated cushion and arm overlaps. Do not overwrite those measurements or treat the accepted overlaps as an unfinished defect.

`check_mutations.py` temporarily breaks parameter upload, field locks, reload preservation, depth variation, walking interpolation, visible world picking, resource cleanup, standing placement, book grips and invalid-storage rejection. It runs the corresponding check and restores exact source bytes in `finally`. Run it only when no other browser, build or editor is using this proof. Its mutations are verification inputs, never deliverable code.

## Runtime contract

`AppearanceProofV1` stores presentation, height, build, hairstyle and five material colors. A separate proof-draft envelope stores the random generator, locks, undo and diagnostic source-material regions. The proof uses only `natural-causes.appearance-proof.v1` browser storage. Invalid data produces an error rather than a replacement character.

The renderer configures the rest control cage and joint positions, skins that cage, evaluates the source subdivision operator, and derives surface normals. Both views use this renderer. The chair uses its actual source geometry and fixed dimensions. Dynamic color, surface depth and actor/fixture identity are separate textures. The game compositor receives the dynamic color and depth through an optional draw callback.

The proposed shape ranges remain fully exposed. No interaction shrinks the body or chair to conceal a collision. Current seating uses a retargeted pose and limb solver; it does not solve every body/fixture intersection. Walking preserves planted shoe positions, transitions join exact standing/seated endpoints, and world picking uses final scene depth. The dated evidence records the collision criterion separately from those working mechanisms and from artwork review.

The proof page is a development entry point. Normal game startup, production saves and the production atlas do not load this character system. No public changelog entry is warranted until player-facing delivery is authorized.
