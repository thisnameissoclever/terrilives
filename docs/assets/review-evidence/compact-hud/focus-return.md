# Compact controls: dialog and Traits focus

An adversarial source review found two keyboard paths that lost visible focus.
The public game confirmed New game followed by Escape left `activeElement`
on `BODY`. Options had already hidden the opener. Returning to Traits after
filling all slots could focus its disabled first checkbox.

Load and New game cancellation now return stranded focus to visible Options.
Confirmed operations keep their existing pause and focus ownership; deliberate
focus elsewhere is preserved. Traits focuses its first enabled checkbox, with
enabled Move in or Back as fallbacks. No control, simulation or save format
was added or removed.

## Local checks

| Check | Result |
| --- | --- |
| Original code with regression tests | FAIL as intended: three assertion failures, exit 1 |
| `npm test -- --maxWorkers=1 tests/options-menu.test.ts tests/housemate-form.test.ts` | PASS: 71 tests, exit 0 |
| `npm run typecheck` | PASS: exit 0 |
| `npm test -- --maxWorkers=1` | PASS: 1,542 tests in 111 files, exit 0 |
| `npm run build` | PASS: exit 0 |
| `python check-doc-ids.py` | PASS: exit 0 |
| `git diff --check` | PASS: exit 0 |

Native sources, content, dependencies and generated art are unchanged from
the verified PR #172 build. Its 1,241 native tests, strict Clippy, formatting,
WASM build, 219 asset tests and atlas reproduction were not rerun for these
TypeScript and documentation changes.

## Deliberate faults

Each fault ran both targeted web files, failed an assertion with exit 1, and
restored the original source bytes and SHA-256 exactly. The complete web suite
then passed. Logs and the replay script remain in `.tmp/bed-assignment/`.

| Fault | Named test | Actual failure |
| --- | --- | --- |
| Omit Load cancellation focus | Load: returns stranded focus to visible Options and releases its pause | `expected "vi.fn()" to be called 1 times, but got 0 times` |
| Omit New game cancellation focus | New game: returns stranded focus to visible Options and releases its pause | `expected "vi.fn()" to be called 1 times, but got 0 times` |
| Omit Load busy-operation guard | Load: leaves a confirmed operation in charge of focus and its pause | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| Omit New game busy-operation guard | New game: leaves a confirmed operation in charge of focus and its pause | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| Focus first trait unconditionally | returns to the first enabled trait when a full selection disables the first box | `expected +0 to be 1` |

Restored `main.ts` SHA-256:
`1cd16a35bebfce3f212b1ab383488ffc4695295230527cd991666d82f6c80625`.
Restored `housemate-form.ts` SHA-256:
`c93fb7594fd463becfd02595fae3eca88c8bd9eec6d15fcb9d9f9a3f4cde39f4`.

The Options tests execute the actual bootstrap close listeners through
`node:vm`; they do not duplicate their implementation. Browser checks below
separately cover native Escape and method-dialog cancellation.

## Displayed production-build checks

The isolated local origin `http://127.0.0.1:5205/` passed these interactions:

1. At desktop size, New game followed by Escape and Load followed by Keep
   playing both returned focus to `options-toggle`. Enter then reopened
   Options from that restored focus. An already paused game remained paused.
2. With four traits selected and the first row unchecked, Back then Next
   focused the first checked, enabled trait. The first row stayed disabled.
3. At 390 by 844, the same Traits round trip retained the enabled focus target
   and produced no document overflow. The draft was cancelled; no housemate
   was added.
4. At phone size with the game running, Load followed by Escape and New game
   followed by Keep playing both returned focus to Options and restored 1x.
   Browser warnings and errors were empty.

Screenshots and DOM observations are retained locally as `focus-desktop.png`,
`focus-phone.png`, `focus-options-phone.png` and `focus-browser.json` in the
same evidence directory. The task-owned page closed in a `finally` block,
the viewport override reset, and the task-owned preview server stopped.
These are displayed browser checks, not a physical-device or screen-reader
listening claim.

Independent read-only review found no remaining actionable defects. It
checked both busy guards, deliberate focus preservation, the enabled-trait
selection and the restoration hashes.

## Public delivery

PR #174 merged as `fbc713159278494f9a2c5208d1bff3a4031d0d96`. The subsequent
sink-audio PR #175 included it in `2021647fbd94801a181b8b2186691d06e13d78a0`.
That revision passed main CI `36829533987`, then the actual Pages deployment
step succeeded in run `36830185174`. Public HTML, JavaScript, CSS and WASM
matched official artifact `11146584283` byte-for-byte.

In the public game, the saved household loaded and advanced. New game followed
by Escape returned focus to the visible Options button. Browser warnings and
errors were empty. The task-owned page was closed in a `finally` block.
