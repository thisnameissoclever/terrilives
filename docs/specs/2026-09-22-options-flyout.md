# Options: one gear for the controls a player reaches for now and then

Current layout: [CUI-world]-[CUI-build] in
[the compact control layout](2026-09-30-control-layout-studies.md) supersedes
this document's control positions. The record below describes the earlier
shipped layout. Options is now at the upper left; Sim information is in the
bottom dock, and Queue mode/Clear orders are inside Queue.

Status: shipped in PR 111 at merge `74152ee`; its played check is [A-options-flyout].

This is [B-options-flyout] in `docs/FEATURES.md`, asked for by the owner on 2026-09-22 after playing. The sidebar held every control the game has, and on a desktop it grew taller than the window. The owner asked for Light, Build, the sound controls, and Save, Load, Clear orders, Queue, New game and Help to move into one flyout opened from a gear at the window's top right. The same notes asked for the Traits panel to be collapsible and closed by default.

The 2026-09-30 gameplay UI update puts speed controls below Time and Funds,
with Build and Exit build at the bottom of the sidebar. Exit build returns
focus to that sidebar button.

The changelog update adds a full-width Changelog link beneath New game and Help. It opens `./changelog/` in a new tab; its accessible name identifies that behavior. The game remains open, and native link activation works by pointer, touch or keyboard.

## [OF1] Where the gear sits

The gear is a 44 by 44 button, named "Options" for assistive technology, fixed to the window's top-right corner inside the safe-area insets, on every screen size and in and out of Build. Its panel opens beneath it, at most 240 pixels wide and never taller than the window, and scrolls on its own. Both live outside `#hud`, as `#object-menu` does, because they are fixed to the window rather than part of the sidebar's column. They come before the sidebar, so the gear is the first stop after the game view for a keyboard. Any open dialog owns Escape, even when focus has fallen to the page, and New housemate closes the panel as Load, New game and Help do.

The gear stacks above the phone Build dock (z-index 2) and below the debug overlay (9) and the right-click flyout (10), at 8. The debug overlay moves 52 pixels down, out of the corner. On a phone in portrait the sidebar's right edge moves 52 pixels in, so the gear never covers the Menu button, and the strip's Time and Funds columns may shrink to nothing, so at 320 pixels wide the strip still fits Menu whole.

## [OF2] Opening, closing and focus

The gear opens and closes the panel. Escape closes it, and so does a press anywhere outside it; a press on the gear or a control inside does not, so the control's press still reaches it. A press outside that lands on the game also acts there, as it does when it closes the right-click flyout: a player who clicks the game meant to click it. Opening it pauses nothing and sends no command: it changes presentation only, as Menu does ([CH2] in `docs/specs/2026-08-12-collapsible-compact-hud.md`). Its Escape is caught in the capture phase, before the game view's own key handler, the right-click flyout's and Build's, and stops there, so one Escape closes an open panel and nothing else. Escape inside a dialog belongs to the dialog.

Choosing Load, New game or Help closes the panel first. Every focus return that used to name a control now inside the panel names the gear instead, since a control in a closed panel cannot take focus: after Load, after a failed New game, and after Help closes. The gear leads the list of fallbacks the persistence controller tries.

## [OF3] What moved and what stayed

Moved into the panel, in this order, with their ids and controllers unchanged: Light, the sound controls (Sound and the Effects level), and Save, Load, Clear orders, Queue, New game and Help.

Stayed in the sidebar: Time and Funds, the Household roster with New housemate, the selected person's needs, mood and traits, People, and the speed controls. The three status lines (the save status, command feedback and the keyboard target line) moved out of the game actions into the household status block, because a live region inside a closed panel is not announced. An empty status line takes no room, so the compact strip grows by one line, the save status.

The phone Menu opens speed, Household, Needs, People and Build sections, and its `aria-controls` names those surfaces. During editing, Exit build also stays visible with Menu closed. During normal play the compact strip is Time, Funds, Menu and the status line. Exit build adds its own row during editing.

The Traits panel inside the needs panel is now a `details` element with a Traits summary, closed in the markup, so each load starts with it collapsed. On a phone it closes with Needs and People when the compact layout starts, and is restored after Build like them.

## [OF4] Evidence

The original played check drove the gear, the panel and Build within it at the browser pane's desktop size and at 375 by 812, and opened Traits on the desktop. The sidebar follow-up is recorded in `docs/specs/2026-09-30-gameplay-ui.md`. Tests pin the controller's open, close, Escape and outside-press rules; that every moved control is inside the panel and every status line inside the household status; the gear's name, its link to the panel and its hidden start; its fixed position, safe-area insets and stacking; that the normal collapsed compact strip keeps no Light or Build row; the listeners' rules through a fake document (the gear toggles, an outside press closes, Escape is caught in the capture phase and stopped, focus returns to the gear, a dialog's Escape is left alone); and, in main.ts, each place that closes the panel or returns focus to the gear, and the Traits panel's place in the phone's list of folding panels.
