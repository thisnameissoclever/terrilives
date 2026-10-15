# Web verification receipts

The complete web sweep initially failed nine assertions. All reported failures are corrected and pass in the final focused run. The original failing log remains preserved; it is not relabeled as a successful full-suite run.

| Command from `web` | Result | Receipt |
| --- | --- | --- |
| `node --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --maxWorkers=1` | FAIL, exit 1: 3,051 passed, nine failed across 231 files | `web-tests-final.log` |
| Focused rerun of the five failing files | FAIL, exit 1: 77 passed, one missing test import | `web-repair-followup.log` |
| `node --max-old-space-size=4096 node_modules/vitest/vitest.mjs run tests/footprint-depth.test.ts --maxWorkers=1` | PASS, exit 0: five tests after restoring the import | `web-footprint-final.log` |
| Final 16-file integration command below | PASS, exit 0: 122 tests, 61.93 s | `web-current-integration.log` |
| `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0 | `typecheck-sleep-final.log` |
| `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build` | PASS, exit 0: 423 modules, 52.61 s | `build-sleep-final.log` |

The nine original failures used stale shader-text parsing, omitted the new framebuffer helper in an extracted test context, treated annotations as physical foreground depth, or required the removed Traits page and rejected condition text. The corrections assert the current contracts, including flat categorical ownership, annotation identity, and absence of the rejected text. A new mutation check rejects interpolated categorical ownership. The first follow-up accidentally removed a still-used `instanceCount` import; restoring it fixes that isolated test error.

The final integration command covers all five formerly failing files plus the current animation plan, native scene contracts, simulation timing, pose path, frame probe, timing-v2 measurement, graphics lifetime, creator session, persistence controller, preparation admission, and preview preparation:

```powershell
node --max-old-space-size=4096 node_modules/vitest/vitest.mjs run tests/character-action-plan.test.ts tests/character-world-contract.test.ts tests/character-simulation.test.ts tests/character-pose.test.ts tests/character-frame-probe.test.ts tests/character-measurement.test.ts tests/character-device-lifetime.test.ts tests/character-session.test.ts tests/persistence-controller.test.ts tests/character-contact-admission.test.ts tests/creator-contact-preview.test.ts tests/architecture-depth.test.ts tests/floor-scene-presentation.test.ts tests/fridge-reach-production.test.ts tests/footprint-depth.test.ts tests/housemate-form.test.ts --maxWorkers=1
```

[Sleeping geometry verification](../sleep-contact-compilation/README.md) and [integration verification](../sleep-contact-compilation/integration.md) record the additional exact geometry, prepared-resource, queue, protocol, and browser-worker checks after that architecture change. [Timing mutations](../measurement-v2/receipt.json) verify measurement semantics in an isolated copy. The final build retains its chunk-size and plugin-time warnings; neither warning was suppressed.

These checks use one test worker and a 4 GiB JavaScript heap limit. Actual browser play, saved-scene attachment equality, and performance remain separate evidence in the parent report.
