# Help dialog proof, 2026-10-16

Scope: issue 67, the browser-driven proof that the first-run help dialog
hides when closed. Script: `scripts/help-dialog-proof.cjs`.

## Runs

Both runs drove the live working tree served by Vite on
`http://127.0.0.1:5174/` from the branch worktree at the head that carried
the final review fixes for the communal affinity work (`0e4801462`), whose
help dialog markup, styles and wiring are identical to `origin/main` at
`618a69369`. The browser was the Chrome channel through the Playwright Core
bundled with the Codex Playwright CLI, headed, with `--mute-audio`, in a
375x812 Android mobile context, then resized to 640x360 for the landscape
check.

| Command | Result | Exit |
| --- | --- | --- |
| `node scripts/help-dialog-proof.cjs --url http://127.0.0.1:5174/` | PASS. Closing: `open false, display none, height 0`. After reload: the same. Reopened from Options, Help: `open true, display flex, height 560, bodyScrollTop 0, activeElementId help-title`. Got it inside both viewports. | 0 |
| `node scripts/help-dialog-proof.cjs --url http://127.0.0.1:5174/ --expect-regression` | PASS (positive control). With `#help-panel { display: flex; }` injected before load, closing reported `open false, display flex, height 560`; the closed-state check rejected it and the run stopped there, because the still-rendered dialog would swallow every later tap. | 0 |

`help-proof-pass.json` and `help-proof-regression.json` are the two reports.

## Limits

Playwright's mobile emulation does not emulate `env(safe-area-inset-*)`, and
the script does not set `Emulation.setDeviceMetricsOverride` over CDP, so the
dialog's safe-area padding is not proven here; the report says so in
`notCovered`. The script needs a running server, so it cannot gate a pull
request; the string-level guard in `web/tests/help-panel.test.ts` remains the
CI proxy.
