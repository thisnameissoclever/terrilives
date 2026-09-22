# Options: one gear for the controls a player reaches for now and then

Status: built on branch `twcl/options-flyout`; its played check is [A-options-flyout].

This is [B-options-flyout] in `docs/FEATURES.md`, asked for by the owner on 2026-09-22 after playing. The sidebar held every control the game has, and on a desktop it grew taller than the window. The owner asked for Light, Build, the sound controls, and Save, Load, Clear orders, Queue, New game and Help to move into one flyout opened from a gear at the window's top right. The same notes asked for the Traits panel to be collapsible and closed by default.

## [OF1] Where the gear sits

The gear is a 44 by 44 button, named "Options" for assistive technology, fixed to the window's top-right corner inside the safe-area insets, on every screen size and in and out of Build. Its panel opens beneath it, at most 240 pixels wide and never taller than the window, and scrolls on its own. Both live outside `#hud`, as `#object-menu` does, because they are fixed to the window rather than part of the sidebar's column. They come first in the page, so the gear is the first stop for a keyboard, and Exit build is two presses away from anywhere.

The gear stacks above the phone Build dock (z-index 2) and below the debug overlay (9) and the right-click flyout (10), at 8. The debug overlay moves 52 pixels down, out of the corner. On a phone in portrait the sidebar's right edge moves 52 pixels in, so the gear never covers the Menu button, and the strip's Time and Funds columns may shrink to nothing, so at 320 pixels wide the strip still fits Menu whole.

## [OF2] Opening, closing and focus

The gear opens and closes the panel. Escape closes it, and so does a press anywhere outside it; a press on the gear or a control inside does not, so the control's press still reaches it. A press outside that lands on the game also acts there, as it does when it closes the right-click flyout: a player who clicks the game meant to click it. Opening it pauses nothing and sends no command: it changes presentation only, as Menu does ([CH2] in `docs/specs/2026-08-12-collapsible-compact-hud.md`). Its Escape is caught in the capture phase, before the game view's own key handler, the right-click flyout's and Build's, and stops there, so one Escape closes an open panel and nothing else. Escape inside a dialog belongs to the dialog.

Choosing Build, Load, New game or Help closes the panel first. Every focus return that used to name a control now inside the panel names the gear instead, since a control in a closed panel cannot take focus: after Exit build, after Load, after a failed New game, and after Help closes. The gear leads the list of fallbacks the persistence controller tries.

## [OF3] What moved and what stayed

Moved into the panel, in this order, with their ids and controllers unchanged: Light, Build (which reads Exit build in Build), the sound controls (Sound and the Effects level), and Save, Load, Clear orders, Queue, New game and Help.

Stayed in the sidebar: Time and Funds, the Household roster with New housemate, the selected person's needs, mood and traits, People, and the speed controls. The three status lines (the save status, command feedback and the keyboard target line) moved out of the game actions into the household status block, because a live region inside a closed panel is not announced. An empty status line takes no room, so the compact strip grows by one line, the save status.

The phone Menu keeps opening the Household, Needs, People and speed sections, and its `aria-controls` names only those. The compact strip is Time, Funds, Menu and the status line; Light and Build no longer have rows in it.

The Traits panel inside the needs panel is now a `details` element with a Traits summary, closed in the markup, so each load starts with it collapsed. On a phone it closes with Needs and People when the compact layout starts, and is restored after Build like them.

## [OF4] Evidence

The played check drives the gear, the panel and Build from it at the browser pane's desktop size and at 375 by 812, and opens the Traits panel on the desktop. Tests pin the controller's open, close, Escape and outside-press rules; that every moved control is inside the panel and every status line inside the household status; the gear's name, its link to the panel and its hidden start; its fixed position, safe-area insets and stacking; that no compact strip keeps a Light or Build row; the listeners' rules through a fake document (the gear toggles, an outside press closes, Escape is caught in the capture phase and stopped, focus returns to the gear, a dialog's Escape is left alone); and, in main.ts, each place that closes the panel or returns focus to the gear, and the Traits panel's place in the phone's list of folding panels.
