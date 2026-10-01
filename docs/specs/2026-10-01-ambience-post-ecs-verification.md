# Ambience verification after simulation memory repair

This plan is recorded before the next acceptance run. It does not replace or
erase any earlier failed run. Draft PR184 remains held until its requirements
are met; PR178 is separate.

## Changed input and fixed protocol

Integrate main c0949f0554f818571b233d0e5f76bb599039a045, which maintains Bevy
removal history after full and paused schedules. Its reviewed release WASM is
SHA-256 da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd.
Matched simulation evidence is in docs/assets/review-evidence/ecs-lifecycle/.
The correction changes allocation behavior while preserving the tested world
hashes and complete save bytes. It does not establish audio memory acceptance.

Run one six-run acceptance sweep after the integrated web suite, typecheck and
build pass. Use the existing command and unchanged harness:

```powershell
node scripts/audio-browser-proof.cjs memory --url http://127.0.0.1:5221/ --output web/output/playwright/indoor-ambience/memory-after-ecs-fix.json
```

Keep all three existing seed pairs, exact tick 60 and tick 600 endpoints, enabled
and disabled ordering, 1,037-entity workload, collection settings, normal
rendering and the raw 65,536-byte allowance. Preserve exact document/node/listener
equality and positive enabled/zero disabled ambience ownership checks. Do not
extend warmup, subtract generated-code growth, disable optimization or repeat
an unchanged failed run to obtain a favorable result.

## Supporting checks and decision

Inspect the newly built game and its desktop, mobile and enlarged-text Options.
Preserve each new receipt separately from earlier screenshots and measurements.
Native audio wiring was rechecked after the main audio merge; the simulation-only
integration does not replace that result or establish subjective listening.

Record the sweep's exit code, comparability, each raw pair difference, median,
structural/source results and the build identity. A pass supports this stated
gate only. A failure keeps the release hold and requires causal analysis of the
new evidence before another attempt. Close task-owned browsers and servers.
