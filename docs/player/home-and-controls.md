# Home and controls

## Give and cancel orders {#orders}

Choose a name under Household to select that person. Click or tap an object for its default action. Right-click, long-press or use the keyboard action menu to pick a particular action. For a conversation, select the speaker and open the other person's menu.

Queue new orders starts on. New instructions join the end of that person's waiting orders. Open Queue from the dock or Sim details to inspect them. On desktop, Ctrl or Cmd while clicking also appends an instruction.

With Queue new orders off, a new instruction goes first. It interrupts the current activity for that instruction while keeping earlier waiting orders after it. It does not empty the queue. Use **Clear orders** in Queue or the object menu to cancel the current player-directed commitment and every waiting order. The object menu shows Clear orders only when that person has player orders to cancel. Closing a menu with Close, Escape or an outside press only dismisses it.

Your explicit instructions have priority over autonomous choices and critical needs. Ordinary need loss and death remain active. You can interrupt work or delay attendance with a player order; that can reduce pay and performance because shifts retain their scheduled ending time. Do not leave a long queue unattended when basic care is becoming urgent.

A new instruction that conflicts with work due or underway opens a paused confirmation showing the affected people, remaining shift time and pay/performance consequences. Proceed sends the order; Cancel leaves queues and attendance unchanged. Existing accepted orders do not prompt again at departure.

:::numbers Numbers and limits
The current game has no fixed per-person waiting-order limit. The visible preview shows as many as fit without discarding the rest. A separate command buffer can refuse a burst of new inputs; the status reports an unaccepted instruction.
:::

## Camera, speed and keyboard {#camera-and-speed}

Drag the game view to move the camera. Pinch on touch or scroll the mouse wheel on desktop to move closer or farther away. Build mode also shows minus and plus zoom buttons. The speed controls pause the household or run it at the available speeds. Faster speed changes how much game time passes, not the meaning of a game minute.

With the game view focused, arrow keys choose a world target. Space selects a targeted person, and Enter opens the target's action menu. Escape closes menus or cancels the current Build selection according to the visible context. The Help dialog lists the current shortcut set.

Press ~ to open or close the [admin panel](ui-elements/#admin-panel). On a touch screen, hold the bottom corner tile of the lot instead. The game pauses while the panel is open.

Opening Options does not pause the household. Build and dialogs that say the household is paused hold game time while open. Use the visible pause control whenever you want to inspect the home without time advancing.

The household keeps running at the selected speed when you switch tabs or minimize the browser, and its sound can keep playing. Pause before leaving the game if you want the household to wait. Choose Sound: off in Options to silence it. A browser can still suspend background tabs to save power; the game does not make up that lost time afterward. The [installed game](#installed-saves) keeps running while its window is minimized and saves when you minimize it.

## Build, confirm and discard {#build}

Open Build from the world controls. You can also choose Enter build mode from a placed object's menu to begin with that exact object selected. Build pauses the household. The tool strip offers Furniture, Buy, Walls, Floors, Rooms and Land. If Build cannot open, a message in the game view explains the refusal.

:::illustration build-furniture

Edits form a draft. Confirm applies the current batch and exits Build after any required review. Cancel at the bottom discards the current batch and exits Build. Cancel beside a selected item, or Escape while it is selected, clears that selection rather than discarding the whole batch. A confirmation failure appears beside Confirm; use its reported cause to correct the draft.

Exit build, or Escape with nothing selected, leaves Build. With unconfirmed changes, it asks you to Confirm changes, Discard changes or Keep building. Read that choice before leaving: a furniture preview and a confirmed household change are different states. If Confirm changes is refused, the question opens again with the reason beside it, so you can still Discard changes or Keep building.

### Review unreachable areas {#access-review}

A layout can leave ground, objects or people unreachable. Choose **Confirm** to review the highlighted ground and the explanation in **Review unreachable areas**. If **Review room changes** opens first, finish your room choices, then choose **Review access**.

Choose **Confirm** to accept the reviewed layout. Choose **Return to build mode**, or press Escape, to keep editing with the draft and highlight available. An edit requires a fresh review. Ordinary Save and autosave do not repeat this approval after the layout is confirmed.

:::illustration build-access-review

The first pool or Sunstrip lounger can take time to prepare for the household. While Build shows **Preparing animations**, choose **Return to build mode** or press Escape to stop waiting and keep the draft.

## Furniture and buying {#furniture}

In Furniture, select a placed object, choose its destination and turn it with the curved arrows. Place applies the move within the draft. Colour choices change its appearance. Sell shows the payout before activation. You can move or sell furnishings that came with the house, just like ones you bought. A physical conflict or object restriction can refuse placement; the reason appears beside Place. Otherwise valid disconnected layouts use the [access review](#access-review).

Buy lists items with prices and filters. Select an item, point at a destination, rotate as needed and choose Buy. The cost comes from household Funds. Unaffordable items are disabled. Room associations organize the store; they do not restrict where an object can be placed. Beds must stand inside a closed room: Buy and Place refuse a bed on the yard. In Build you may remove a wall or change a room around a bed while you work, but Confirm is refused while the change would leave a bed outside; move the bed into a room or choose Cancel. A bed already outdoors in an older saved game stays there and works.

Choose **Back to catalog** beside the preview to return to the item cards. The filters, scroll position, highlighted card and other draft edits remain. Choose the card again to resume placement. A blocked Buy shows its current reason beside the button, separately from a completed purchase receipt.

An object's type identifies what it is, while the model identifies the particular product. Activate its name to read its optional description. A store listing alone does not promise an activity. Some objects are decorative or have no use action; inspect available actions and the [activity reference](activities/#all-actions).

Bookcases also offer automatic [book buying and selling](activities/#reading). A borrowed copy retains a home slot, so visible gaps do not always mean free capacity.

## Walls, windows and floors {#walls-and-floors}

Walls selects the edge between floor tiles. Click a wall to select it, or the floor near an edge; with a mouse, the edge a click would select is marked first. Select a second edge further along the same row to select every edge between them. Use the contextual controls to add a wall, doorway or window, or remove the selected boundaries. Windows stop people while letting daylight through. They are part of Walls, rather than a separate top-level tool. A wide window centres on the spot you click and slides along the wall to fit. Doors follow doorways and open for passing people.

While Walls or Rooms is open, walls are drawn low so the front walls do not hide the floor; the selected wall stands at full height. Choose Full height, or press T, to see every wall at full height. Walls on the edge of the lot can hold windows and doorways. An open boundary segment can provide an arrival or departure route; walking within the game remains limited to owned ground.

Original and player-built walls, doors and windows follow the same editing rules. Physical conflicts with furniture, people or ongoing use remain refusals. A valid edit that disconnects ground or blocks an object's approaches instead requires [access review](#access-review). A wall can also change which people share a room, affecting privacy and ordinary contact once the room changes are confirmed.

Floors selects a tile. Select a second tile to select every tile in the rectangle between them; tiles that cannot take a covering are marked and left alone. Choose Boards, Tiles, Carpet or Outdoor patio to change the covering. Remove clears the covering and replaces any underlying indoor floor with grass. Underlying grass and street surfaces stay unchanged. Confirm applies the batch after any required review and exits Build. Covered outdoor ground can collect and be cleaned of grime; bare grass and street do not collect floor grime.

An edit waits for any missing floor materials, then applies automatically. If loading fails, choose **Retry** to continue or select another covering. Retry continues the waiting edit if the selected tiles and draft still match. Changing either, choosing another covering, leaving Floors or loading another household cancels the waiting edit. Retry with no tile selected loads the material for later use; select a tile and choose its covering to apply it.

## Rooms and land {#rooms-and-land}

Rooms opens Select rooms. Click the floor or choose a room from the list, then edit its name. Outside is one named room. A name stays pending across tool changes, and Enter in the name field does not confirm the batch.

Confirmed boundaries determine room identity. Splits, merges and lost enclosures can open a review before confirmation; Back to build keeps the draft and current tool available to adjust. If you reached the review while switching from Walls to Land, Back to build returns to Walls. Build room chooses a rectangle using opposite corners, with a doorway if needed. Detected rooms can have more complicated shapes than those rectangles.

Choosing Land starts a fresh batch while Build stays paused. If the current batch has changes, Switch to Land? asks you to Confirm changes, Discard changes or Keep building. Confirm changes keeps that batch and opens Land; Discard changes undoes that batch and opens Land. Keep building retains the current tool and draft. Room review can still be required before confirmation finishes.

Land offers Behind the house, Left side and Right side, measured from the street looking at the house. Choose a strip to inspect its dimensions, price and remaining Funds. **Buy land** opens a separate land-purchase confirmation; choose **Buy** there to add the purchase to the Build draft. The bottom Build **Confirm** keeps it and exits Build, while discarding that draft restores the previous land and Funds. Confirmed room and plot changes affect usable destinations and outdoor presentation.

## Household chores {#chores}

Open Chores in the dock for the weekly assignments and their current outcomes. Choose a person first if you want Do now to send that person to the work. Dirty dishes, floor grime, surface grime and bin waste are distinct work types.

The selected person's profile lets you edit responsibility and preferences for dishes, floors, surfaces and bins. Apply preferences affects future daily decisions. Commitment history records follow-through separately from enjoyment. The board pauses game time while open.

Completed physical cleaning removes actual dirt and earns other living housemates' appreciation toward the cleaner, even with the board off or without an assignment. The work supplies no direct Hygiene or other need refill. Fresh mess has a [grace period](relationships/#mess-and-nuisance) before ordinary mood penalties and complaints, but you can clean it immediately.

Assignments identify who can be blamed for an overdue duty. A completed chore argument may prompt that owner to start work; completing the same duty within four game hours can [repair feelings](relationships/#chore-repair). Your orders, critical needs and work still take priority over that automatic response. Starting or canceling an unfinished task earns no completion reward.

## Save, Load and New game {#saves}

Options contains Save, Load, Export save, Import save and New game. Save writes the current household to the game's save slot: browser storage on the website, or a file on your computer in the [installed game](#installed-saves). Autosave writes at the beginning of each new simulated day. A save includes people, needs, relationships, time, active work, accepted work trips, queued orders and career reviews, including pending reviews and recorded inputs, so the household can resume.

Before each save replaces the previous one, the game keeps a copy of it. If the latest save cannot be read, for example because the game closed in the middle of saving, Load and the game on opening use that copy instead and say so. The unreadable file is kept aside, and the copy never brings back a household you removed with New game. A save from an unsupported version is never replaced this way.

Load asks before replacing progress with the saved household. An invalid or incompatible save is rejected without replacing the running household. New game asks before deleting the local save and returning to the authored starting household.

Saves carry the effect that needs have accumulated on mood. Older saves that predate this effect start with a neutral contribution. **Load** and **Import save** can resume households from the earlier editable-world builds, including versions 24, 25 and 26. If the game cannot open or recover the save it already has, saving pauses and **Export save** lets you download the original file.

Choose **Load game** in the Load confirmation to restore the save. Choose **Start over** in the New game confirmation to delete the local save and begin again. **Keep playing** closes either confirmation without replacing the household.

:::illustration load-confirm

On the website, the slot belongs to the game's site in this browser. A different browser, browser profile or site address has separate storage, and so does the installed game. Light and sound preferences are separate from household progress.

### In the installed game {#installed-saves}

The installed game for Windows and Mac keeps its saves as files in a folder on your computer instead of browser storage: `%APPDATA%\Natural Causes\saves` on Windows, or `~/Library/Application Support/Natural Causes/saves` on Mac. Save, Load, autosave, the kept copy and New game work as described above. Clearing browser data does not touch these files, and uninstalling the game leaves them in place, so a reinstalled game finds them again. To open the folder on Windows, paste its path into the File Explorer address bar; on Mac, choose Go, then Go to Folder in Finder. Delete the folder to remove the saves for good.

The installed game also saves when you minimize its window and before it closes. Closing waits up to ten seconds for that save to finish. Time keeps passing while the window is minimized.

To move a household between the website and the installed game, in either direction, use Export save in one and Import save in the other, as described below.

### Updates in the installed game {#installed-updates}

The installed game looks for a new version each time it starts. Nothing interrupts play.

On Windows and Mac, it downloads the new version in the background. When the download is ready, a note under the time says "Update ready. It installs when you close the game." The next time you close the game, the update installs, and the game opens updated next time.

Your saves stay in place through an update. The website always runs the newest version and shows no update note.

### Move a save to another browser, device or the installed game {#export-import}

Choose Options, then Export save to save the current household as a file ending in `.ncsave`: the website downloads it, and the installed game asks where to save it. Exporting leaves the saved game where it was. While saving is paused because the stored save could not be loaded, Export save downloads that stored save unchanged instead of the running game.

To use the file, open the game where you want to play (another browser, another device, the website or the installed game), choose Options, then Import save, and pick the file. Choose **Import game** in the confirmation. The imported household replaces the running game and its saved game, and this cannot be undone, so export the current game first if you want to keep it. **Keep playing** closes the confirmation without changing anything. A file that is not a Natural Causes save, a damaged save, or a save from a newer version of the game is rejected and the current game is kept. While saving is paused because the existing saved game is unreadable or from a newer version, Import save cannot replace it: export it first if you want to keep it, choose New game, then import again.

:::illustration import-confirm

### Saves from the old web address {#old-address}

On the website, Export save also opens prominent recovery instructions with a link to the old website's recovery page. Close the instructions with Close or Escape. The installed game opens only its save dialog.

:::illustration save-recovery

If you played at thisnameissoclever.github.io/terrilives, natural-causes.life starts without your household, because a save stays in the browser where it was made. The old address now opens the new one. To bring that save across, open [Move your Natural Causes save](https://thisnameissoclever.github.io/natural-causes-old-save/) in the same browser and on the same device, choose **Download save**, then use Import save at natural-causes.life or in the installed game.

Do this soon. Some browsers, including Safari, can clear saved data for a site you have not visited for a while.

## Add or edit a housemate {#housemates}

Exit Build before adding or editing a housemate; both controls are disabled while Build is active. Choose Options, then New housemate to create someone. Select an existing living person and choose Edit beside their name to change them. The creator has Identity, Appearance, Personality, Needs & habits, Interests & skills, Household and Review pages.

All pages edit one private draft. Randomize changes unlocked values; locks protect them from randomization. Reset section restores that page's defaults, and Undo restores the previous draft operation. On a phone, Show preview opens the character preview. Review lets you inspect the combined result before applying it. Cancel discards the draft.

When the draft is ready, open **Review** and choose **Move in** for a new person, or **Apply changes** when editing. Wait for the change to finish. Choosing another creator page does not add the person or apply the draft.

:::illustration creator-review

Editing preserves unedited needs, work, career and history. Appearance changes do not require a personality change. Household relationships identify family ties separately from current feelings. A new housemate begins without a job; automatic job search can find one, or you can assign a path in Career.

## Options and accessibility {#options}

Options contains lighting, sound, the death setting, automatic career changes and household actions. Light: auto follows time of day and local lights. Light: flat supplies neutral daylight. Sound mutes the mix, Effects changes overall effects volume, and Voices changes conversation volume within it.

Reduced motion suppresses weather particles and uses flat lighting while keeping weather text. The saved lighting preference remains available when that setting changes back. Use visible text labels, mood reasons and status messages alongside colors and animations.

Open Help for the short controls reference or the full player guide for the longer explanations. Changelog opens the update history in another tab. Report bug prepares an email to Tim with the recorded error and newest logs that fit. Review the draft before sending it. See [UI elements](ui-elements/#options) for the exact desktop and phone route.
