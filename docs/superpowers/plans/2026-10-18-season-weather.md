# Season weather implementation plan

**Goal:** Keep grass green and show occasional seasonal weather outdoors, with a separate season and condition line below the clock.

**Approved scope:** Visual effects only. Winter snow occurs on roughly one day in five for two game hours. Autumn has occasional falling leaves that remain for two game hours after landing. Summer has occasional two-hour hot periods. Other periods are mild. Weather follows game time through pause, speed changes and save/load; it does not change needs or chores.

**Architecture:** Keep weather tuning in `content/tuning.toml` and expose it through the existing Rust/WebAssembly content boundary. Derive presentation weather from the saved clock without consuming simulation randomness. Render bounded procedural particles through the existing effects pass and use Outside room tiles to exclude enclosed rooms.

**Tools:** Existing Rust, TypeScript, WebGPU and Vitest; no dependency changes.

1. Add failing content and clock tests. Replace the brown and pale seasonal tints with subtle green-preserving shifts. Add validated optional weather tuning, preserving historical pack reconstruction.
2. Add a pure weather schedule and bounded particle sampler. Test event probability, start/end boundaries, pause, repeated queries, short content days, leaf expiration and outdoor masks. Render snow and leaves in the scene effects pass without changing scene ownership or depth.
3. Show date, time and `Season: condition` on three lines. Update clock callers, fixtures, responsive styles and behavior documentation.
4. Verify with relevant Rust and web suites, type checks, lint and build. Deliberately break the schedule and exclusion/expiration guards to prove their tests fail, then restore the exact bytes.
5. Play the real game at desktop and phone widths. Inspect matched defective/corrected grass captures and watch weather and leaf transitions. Obtain a fresh independent code and visual review, including rejection of the defective grass capture. Retain selected screenshots and written evidence; close task-owned pages and servers.

**Review focus:** Weather must remain consistent after load; particles must not enter newly enclosed rooms; leaves must expire while offscreen; reduced motion must suppress falling animation without hiding weather text; clock text must fit at phone widths. Historical saves and frozen content witnesses must retain their existing contracts.

The owner approved this scope on 2026-10-18. Implementation remains in this branch until delivery is authorized.
