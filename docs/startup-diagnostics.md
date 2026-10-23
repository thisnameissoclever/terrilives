# Startup failure reports

The game saves its last three startup attempts in browser-local storage. Each attempt records the game entry filename, browser and viewport details, timestamps, the last loading step, and a captured error when available. It marks readiness only after the graphics queue completes the first scene. Removing the loading cover does not establish readiness.

Open [Startup report](https://thisnameissoclever.github.io/terrilives/startup-report.html) in the same browser that loaded the game. Copy debug details copies the report for sharing. If clipboard access is blocked, a selectable text field appears. Email Tim opens the configured mail application with recipient `bugreport@stfuai.com`, subject `[Bug report] Natural Causes vX.X.X`, and the complete report in its body. The player reviews and sends the draft. These actions also appear on the terminal failure card.

Download report saves the same report as JSON. The report page loads a small script and does not start the game, simulation or graphics device. Reading or sharing a report does not overwrite the stored attempt. If a mail application omits a long message body or no mail application is configured, Copy debug details and Download report remain available. The generated email link does not truncate the saved details.

The build reads its version from `web/package.json` and supplies it to the game HTML and standalone report through `web/startup-report/plugin.ts`. New attempts retain this version. For an older attempt without a recorded version, the report uses the current report-page version and labels that source explicitly; it does not assign that version to the older attempt. The sharing context also retains the visible failure-card summary and the reporting browser details. An active failure card can share its in-memory report when browser storage is denied.

An unfinished attempt means readiness was not recorded. Closing the page during loading also produces that state; it is not evidence of a browser crash by itself. A browser termination can preserve the last saved step while preventing JavaScript from recording its cause. A report saved before this recorder was deployed is unavailable. Reports in another browser or cleared storage are unavailable as well.

Character download failures retain selected delivery headers, the resource pathname and at most 1,024 response-body bytes. Error-body reading waits at most one second. Cookies, authorization headers and URL queries are excluded from this structured HTTP record. Errors forwarded through the preparation worker retain bounded response details in their message.

Reports also preserve the worker error name, operation kind and up to 4,096 characters of its forwarded stack, separately from the main error stack. This keeps the original worker location available when the main thread wraps its error.

The recorder stores no household save and sends no data automatically. Browser storage denial or exhaustion must not prevent loading. The saved report is bounded to three attempts and 32,768 serialized characters. A selected response body is diagnostic material from the delivery service, so review the report before sharing it.

The recorder is a small classic script loaded before the game module. Its page and script remain separate from the game bundle so a report can be retrieved without allocating the game's resources. The current interface uses `startup-diagnostics-v2.js`; the original script remains published for cached HTML. Preserve storage-schema and event compatibility when changing them. The application signals `terrilives:startup-ready` after successful first-scene completion, `terrilives:startup-failure` on handled startup or first-frame errors, and `terrilives:startup-report-controls` after inserting the share controls.

The clipboard call runs directly inside the click handler, preserving the [user gesture required by WebKit](https://webkit.org/blog/10855/async-clipboard-api/). Email fields use the [`mailto` format](https://www.rfc-editor.org/rfc/rfc6068.html), including escaped header/body values and CRLF body line endings.

These reports supply missing observations. They do not establish the cause of an earlier iPhone failure or prove recovery on a physical device.
