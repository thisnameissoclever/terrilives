# Compact dock height assertion

Changed only `web/tests/housemate-form.test.ts:725`: the compact dock header assertion now expects the approved 36px minimum height instead of 44px. The adjacent Creator 44px assertion and all other assertions remain unchanged. No production source, documentation, Git index or commits were changed.

Command: `NODE_OPTIONS=--max-old-space-size=2048 npx.cmd vitest run tests/housemate-form.test.ts --maxWorkers=1` from `web/`.

Result: exit 0; 1 test file and all 54 tests passed. Output retained in `height-assertion-fix.txt`.

Ownership and the focused test slot are released. Root owns delivery.
