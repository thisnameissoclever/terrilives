# Build confirmation and cancellation

Build mode treats the paused simulation as a draft. Existing furniture, wall, window, room, floor, and store actions update that draft. Place accepts an individual furniture preview into the draft. Switching selections or tools never makes a draft permanent.

The bottom of the build flyout contains Cancel followed by Confirm. Confirm settles queued edits and any pending furniture placement before recording a new baseline. Cancel restores the most recent baseline. Escape cancels pending changes; Exit build cancels them before resuming play. Confirming one batch and cancelling the next keeps the first batch.

`BuildSession` owns the baseline through the existing simulation save and validated-load APIs. All persistence paths use its committed snapshot, including manual Save, autosave, update, and graphics-device recovery. Successful Load replaces the baseline with the loaded household. Rejected Load preserves it. A failed rollback keeps Build open and paused, reports the failure, and retains the baseline.

Cancellation clears queued draft commands and tool receipts, restores funds and owned objects, and refreshes architecture, floor resources, selection, lighting, and audio. Store purchases, sales, and book transactions made during Build belong to the same batch. Household editing, chores, death settings, and Sim-detail controls are unavailable while the batch is active so cancellation cannot silently undo unrelated changes.

Physical room outlines include the owned lot perimeter. Perimeter solids are saved, drawn, and validated as physical architecture. They do not become movement-grid barriers between an owned tile and an out-of-bounds tile: off-lot movement is already disallowed. Doorways remain interior-only. The Wall tool can remove and rebuild explicit perimeter solids while preserving the original implicit rear shell. The original implicit rear house shell is not duplicated. Existing saves are preserved without guessing where old incomplete rooms were meant to have walls.

The window action is Place Window, and contextual cancellation controls read Cancel. Functional labels describe the action without humor.

Verification covers committed versus draft save bytes, cancellation before and after command draining, chained edits, confirmed-batch retention, rejected rollback, successful and rejected Load, perimeter geometry, and save round trips. Browser checks cover desktop and compact controls, including the button order and Exit behavior.
