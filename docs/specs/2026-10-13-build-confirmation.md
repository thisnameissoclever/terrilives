# Build confirmation and cancellation

Build mode treats the paused simulation as a draft. Existing furniture, wall, window, room, floor, and store actions update that draft. Place accepts an individual furniture preview into the draft. Switching selections or tools never makes a draft permanent.

The bottom of the build flyout contains red Cancel followed by green Confirm. Confirm settles queued edits and any pending furniture placement. When the final arrangement splits, merges, or opens existing rooms, it presents the room-change review before recording a new baseline. Back to build discards that review and retains the draft. Confirm changes accepts the exact reviewed arrangement. Cancel restores the most recent baseline. Escape cancels pending changes; Exit build cancels them before resuming play. Confirming one batch and cancelling the next keeps the first batch.

The native simulation owns the baseline, accepted-command journal, pending room names, and prepared review. Browser `BuildSession` settles previews and presents the controls. Confirm replays accepted edits from the baseline into a private candidate, resolves final room membership once, and validates that candidate before adoption. A review token identifies its session, revision, and preparation; an obsolete token cannot commit another arrangement. See [room identity and naming](2026-10-17-room-identities.md).

All persistence paths request committed native bytes, including manual Save, autosave, update, and graphics-device recovery. Dirty drafts and open reviews never replace the committed save. Successful Load replaces the baseline with the loaded household and clears the old journal. Rejected Load preserves both. A failed preparation, commit, or rollback keeps Build open and paused, reports the failure, and retains the baseline.

Cancellation clears queued draft commands and tool receipts, restores funds and owned objects, and refreshes architecture, floor resources, selection, lighting, and audio. Store purchases, sales, and book transactions made during Build belong to the same batch. Household editing, chores, death settings, and Sim-detail controls are unavailable while the batch is active so cancellation cannot silently undo unrelated changes.

Room names, chore assignments, and room-entry consequences remain unchanged during edits. Detection compares the last confirmed rooms with the final draft, so removing and restoring a wall in one batch preserves identities and names. New unrelated enclosures receive numbered names at Confirm. Build remains open so the player can select and rename them in another batch. Outside counts as one shared room; grass remains ineligible for floor cleaning.

Physical room outlines include the owned lot perimeter. Perimeter solids are saved, drawn, and validated as physical architecture. They do not become movement-grid barriers between an owned tile and an out-of-bounds tile: off-lot movement is already disallowed. Doorways remain interior-only. The Wall tool can remove and rebuild explicit perimeter solids while preserving the original implicit rear shell. The original implicit rear house shell is not duplicated. Existing saves are preserved without guessing where old incomplete rooms were meant to have walls.

The window action is Place Window, and contextual cancellation controls read Cancel. Functional labels describe the action without humor.

Verification covers committed versus draft save bytes, cancellation before and after command draining, chained edits, confirmed-batch retention, rejected rollback, successful and rejected Load, perimeter geometry, and save round trips. Browser checks cover desktop and compact controls, including the button order and Exit behavior.
