# Integration regression witnesses

The four causal checks ran serially against source revision `4550ba2d2587f7aa7ef740fc27996530f824914a`, with the test repairs in this directory's delivery commit. Each control passed, one mechanism was changed, the named assertion failed, source bytes were restored in `finally`, and the restored control passed. No mutated source is delivered.

`summary.json` records exact commands, exits, source and test SHA-256 values, observed failure text and restored test counts. Raw outputs remain in ignored local `.superpowers/architecture-integration-mutations-4550ba2/`; their byte hashes are in each receipt. The source hash describes working-file bytes, including their actual line endings; the Git blob hash separately identifies committed bytes.

1. Queued commands: moving FitWindow's hash tag from 20 to released bed tag 19 reproduces the exact matching-fields collision. Control and restored runs each pass one test; the mutant fails with exit 101.
2. Rooms: replacing expanded `window_lines()` with V2-only `windows()` joins rooms across V3 wide windows. Control and restored runs each pass one test across both axes; the mutant fails with exit 101.
3. Door ownership: deleting only the horizontal hinged-door registration leaves duplicate authored doorway frames. Control and restored runs each pass two cutaway cases covering both axes; the mutant fails with exit 1.
4. Context controls: deleting only the production WindowTool change hook's invalidation leaves cached Fit disabled after choosing a valid replacement model. The test executes the actual main hook and real WASM controller/drain path. Control and restored runs each pass one test; the mutant fails with exit 1.

These are internal test and evidence changes. They introduce no additional player-visible behavior and need no new public changelog note. Broader regression, GPU and browser verification remain separate delivery gates.
