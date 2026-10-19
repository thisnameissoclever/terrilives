# Published schema nineteen inputs

These saves come from the published WebAssembly binary for commit `b6078ea472c6b596a7aa7491a3d1b0f491fd24c7`, whose binary SHA-256 is recorded in `docs/evidence/2026-10-19-social-balance/verification.md`. The producer checks that exact binary before running it. No current writer produced these bytes.

1. `initial.sav` captures `SimHandle.from_lot()` before a tick or command.
2. `running-fight.sav` captures the same household at tick 49, during the player-ordered generic argument between the first two named people. The public TalkTo command is `[4, 34, 35, 1]`; both participants display published topic 26.

`manifest.json` records the source revision, binary and JavaScript hashes, saved byte hashes, lengths, ticks, original world hashes and the published reader's own admission result. That reader accepts the initial capture but refuses its running fight capture; the latter also preserves evidence of the published admission defect. The original world hashes describe that published executable; current continuation additionally hashes its explicit legacy fight context.

Reproduce with Node and the preserved published JavaScript/WASM pair:

```powershell
node produce.mjs <published-terri_wasm.mjs> <published-terri_wasm_bg.wasm>
```

The simulation uses only its shipped synthetic household. The producer always frees its simulation. The large executable and JavaScript module remain in ignored local scratch storage and are not committed with these inputs.
