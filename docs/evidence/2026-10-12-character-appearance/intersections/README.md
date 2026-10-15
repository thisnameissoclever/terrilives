# Chair intersection images

These images show the unchanged proof geometry at reading frame 0. The left panel is a current browser capture with a yellow location marker. The right panel is an exact planar section of the runtime geometry used by the contact check. Red identifies clothing inside a fixture. The diagnostic exposes geometry hidden in the opaque browser view; it does not establish that the overlap is visually unacceptable.

1. `seat-evidence.png`: masculine height 0 (85% standing height), build 100. A trouser leg enters the seat cushion by 0.0483239 model units at the deepest sampled vertex.
2. `arm-evidence.png`: the same appearance. The shirt hem enters the right chair arm by 0.0266401 model units at the deepest sampled vertex. The other arm is effectively symmetric.
3. `back-evidence.png`: masculine height 50 (100% standing height), build 100. The shirt enters the back cushion by 0.0150414 model units at the deepest sampled vertex.

The seat and back sections are vertical planes through the measured point. The arm section is horizontal. The overshirt has an open neckline, so its section is drawn as an open contour rather than filled with an invented closing surface. All parts remain at their actual coordinates. The section views use equal scale on both axes, but their scale differs between panels.

These are representative maxima, not the only affected configurations. Short height 0/build 0 has smaller trouser/seat intersections near 0.00878 model units; height 0/build 50 reaches about 0.02046. The corresponding short/wide feminine case has the same maximum seat penetration. Measurements are sampled local depths, not proven whole-surface maxima.

`sections.json` records the exact source hashes, witness hashes, measured points and section segments. `capture.json` records the browser version and capture scope. The raw `seat-0.png` through `back-3.png` retain all four facings without annotations. Capture filename suffixes are viewing facings; witness filename suffixes are animation keyframes.

Reproduce sections with the existing hidden Blender launcher and `assets/models/sims/appearance-proof/intersection_sections.py`. Start the development server from `web/`, run `node assets/models/sims/appearance-proof/capture_intersections.cjs` from the repository root, then run `python assets/models/sims/appearance-proof/compose_intersections.py`. Stop the task-owned server afterward. No source geometry, pose, fixture, tolerance or slider limit is changed by these scripts.
