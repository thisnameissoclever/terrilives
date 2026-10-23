# Startup failure reports

The game saves its last three startup attempts in browser-local storage. Each attempt records the game entry filename, browser and viewport details, timestamps, the last loading step, and a captured error when available. It marks readiness only after the graphics queue completes the first scene. Removing the loading cover does not establish readiness.

Open [Startup report](https://natural-causes.life/startup-report.html) in the same browser that loaded the game. The terminal failure card also links to this page. Download report saves the recorded data as JSON. The report page loads a small script and does not start the game, simulation or graphics device. Reading or downloading a report does not overwrite the stored attempt.

An unfinished attempt means readiness was not recorded. Closing the page during loading also produces that state; it is not evidence of a browser crash by itself. A browser termination can preserve the last saved step while preventing JavaScript from recording its cause. A report saved before this recorder was deployed is unavailable. Reports in another browser or cleared storage are unavailable as well.

Character download failures retain selected delivery headers, the resource pathname and at most 1,024 response-body bytes. Error-body reading waits at most one second. Cookies, authorization headers and URL queries are excluded from this structured HTTP record. Errors forwarded through the preparation worker retain bounded response details in their message.

The recorder stores no household save and sends no data automatically. Browser storage denial or exhaustion must not prevent loading. The saved report is bounded to three attempts and 32,768 serialized characters. A selected response body is diagnostic material from the delivery service, so review the report before sharing it.

The recorder is a small classic script loaded before the game module. Its page and script remain separate from the game bundle so a report can be retrieved without allocating the game's resources. Preserve its storage schema and event compatibility when changing either file. The application signals `terrilives:startup-ready` after successful first-scene completion and `terrilives:startup-failure` on handled startup or first-frame errors.

These reports supply missing observations. They do not establish the cause of an earlier iPhone failure or prove recovery on a physical device.
