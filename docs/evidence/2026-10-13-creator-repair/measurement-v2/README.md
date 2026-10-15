# Frame timing and observer verification

The second timing format records the browser's animation timestamp, actual callback entry, draw submission, and graphics completion separately. Execution time starts at callback entry. Callback delay remains visible, and the earlier timestamp-to-submission and timestamp-to-completion measurements remain available as frame latency and completion latency. Earlier receipts are unchanged; their field named `cpuMs` includes callback delay and must not be interpreted as execution time alone.

The benchmark also stopped cloning full character diagnostics on every frame. `probeFrame` copies primitive fields into caller-owned slots and records stable resource identities. The benchmark retains full snapshots before and after measurement, changes of action or resource, camera state, focus, visibility, and every slow frame. It measures its own probe cost.

`node scripts/character-creator-repair/check-measurement-mutations.cjs` exited 0. [The receipt](receipt.json) records the isolated baseline pass, failure when execution starts at the animation timestamp, failure when callback delay is discarded, and the restored pass. Both production source preservation and exact isolated restoration are true. The test runner uses one worker and a 4 GiB heap limit.

The first actual timing-v2 gameplay run is [sleep-v2-dev](../performance/sleep-v2-dev/game-30000-normal-driver.json). Its 1,801 game samples have a maximum execution time of 13.40 ms. Combined game and animated-preview completion has one sample above 16.6 ms among 1,800 preview frames, with a maximum of 26.345 ms. The frame observer has a 0.01 ms 95th percentile and a 0.09 ms maximum. These are desktop observations from that recorded workload, not guarantees for every machine or future scene.
