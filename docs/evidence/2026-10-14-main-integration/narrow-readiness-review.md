# Hidden-preview readiness repair

The independent built-game review found that a cold creator at 390 by 844 pixels could not submit while its optional preview was hidden. Opening the preview enabled Move in. The original capture and receipt remain in `built-review/narrow-01/`.

The view now distinguishes the latest required appearance preparation from a completed preview draw. Hidden previews prepare the configuration without drawing or advancing their clock. Submission requires current preparation and no preview error; the session still independently requires and queues the matching contact artifact before submitting a native command.

The first regression run rejected the old behavior in three assertions. The repair adds request generations so an obsolete completion cannot enable a newer draft, including A-B-A edits, and ignores completions after closure.

A fresh source review found a further case: after a successful A draw, hidden B preparation could fail, and Undo to A retained B's error because A still matched the last drawn key. `narrow-undo-red.log` records that failing regression. Clearing obsolete errors on appearance-generation changes resolves it. The final source review found no remaining concrete defect within preparation readiness, superseded completion/error handling, closure, and submission admission. It did not execute browser checks.

`narrow-readiness-accepted.log` covers the focused view, preparation, draft, and session checks. The subsequent built-browser review must establish cold hidden-preview creation and editing; source review and unit passes do not establish those interface results.
