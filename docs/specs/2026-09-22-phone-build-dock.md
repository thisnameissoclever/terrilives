# The phone Build dock keeps its buttons in view

Status: [PD-slice-dock] is built, on branch `twcl/phone-build-dock`.

This is [B-phone-build-dock] in `docs/FEATURES.md`, found in review of
catalogue browsing. On a phone the Build panel is a dock capped at 45% of the
screen height. It scrolled as one piece, so with an item chosen in the Buy
tool, Buy and Cancel sat below its fold at 390 by 844 and every purchase took a
scroll inside the panel. The same held for Confirm in the Furniture tool.

## [PD-parts] Each tool is its choices, then a footer

Every Build tool's markup holds two parts: its choices (the lists, the facing
and Rotate row, the price, what it is good for, the rotation note and the help
lines), then a footer of its status line and the buttons that act on it. The
Walls and Room tools have no lists, so their choices are only the help lines.

On a desktop nothing moves. The choices part takes no box of its own, so its
rows sit in the tool's own grid as before, and the help lines are ordered
after the footer, as they always were. Screen readers read the help before the
footer; nothing in the help is focusable.

## [PD-tall] On a tall phone only the choices scroll

On a compact screen at least 481 pixels tall, the panel is a column: the tool
buttons, then the tool, whose choices take whatever height is left and scroll,
and whose footer never shrinks. The footer is always in view and nothing sits
behind it, so a tap on a visible control always reaches it, and keyboard focus
moving into the choices scrolls them the ordinary way.

In the Furniture and Buy tools, which have lists, the choices never shrink
below 52 pixels, one whole list row and room for its focus outline. The Walls
and Room tools have only help lines there, so they keep no floor and no blank
space. Where the footer and the floor together do not fit, as at 320 by 481
with the stove's sale note, or with a status long enough to wrap to three
lines, the panel itself scrolls as a last resort, so the end of the footer is
always reachable.

Hidden always wins. The phone layout gives the panel and the tools displays
whose selectors could outrank a plain hiding rule, which once showed the
panel outside Build, so the rule hiding the panel and the tools is marked
important. A test checks that it is, and that no other rule gives any element
an important display.

An earlier version of this slice pinned the footer over a panel that scrolled
whole. Review found that it hid whatever scrolled behind the footer: Buy's
Rotate at 390 by 844, the whole Buy list at 375 by 667, and keyboard focus
that could land behind the buttons without the panel scrolling. A footer
outside the scrolling region has none of those problems.

## [PD-short] Held sideways the panel scrolls whole

Below 481 pixels of height the panel can be 144 pixels tall, too short for a
footer and a useful region above it, so it scrolls as one piece as before.

## [PD-rows] Rows the panel can spare, on every compact screen

* The heading and the "Household paused" note leave the view but stay in the
  page, so the panel keeps its accessible name. The chosen object's name is
  still in its list, the dock itself shows Build is on (Exit build is in the Options flyout), and the HUD clock
  stops, which shows the pause. On a desktop both stay in view.
* The four tool buttons share one row, with their side padding trimmed so
  "Furniture" fits at 320 wide. Below 301 pixels wide they return to two by
  two, since one row of four would be under 60 pixels a button.
* Each list's label sits beside it rather than above it.
* In the Furniture tool, Sell joins Confirm and Cancel in one row.
* The panel's 45% cap counts its border and padding.

## What the player sees

At 390 by 844, with a chair chosen in Buy, everything is in view at once: both
lists, Rotate, the price, what it is good for, the status, Buy and Cancel. At
375 by 667 both lists and the footer are whole and Rotate is cut by the edge of
the scrolling region, one short scroll away. At 320 by 568 with the stove
chosen in the Furniture tool, the footer holds the two-line sale note and the
choices region shows the list, with Rotate a scroll away.

## Review record

A fresh-context review of the first version found the pinned footer hid Buy's
Rotate at 390 by 844 and the Buy list at 375 by 667; let keyboard focus land
behind the buttons; let "Furniture" overflow its button at 280 wide; left two
layout breaks untested; left a 10 pixel strip of content under the pinned
footer; and had inaccurate notes. The design above replaces the pin, which
answers the first, second and sixth. The tools return to two by two below 301
pixels wide, the tests now forbid any sticky rule and check each part of the
new layout, and the notes were rewritten from new measurements.

A second round found that the panel's column rule outranked the rule hiding
the panel, so on an upright phone the Build panel showed outside Build over
the game view and the menu. It is now written for a shown panel only, with a
test over every rule that could outrank the hidden one. It also found that at
320 by 481 a tall footer could squeeze the list to a few pixels and clip the
sale note beyond reach; the choices now keep a floor and the panel scrolls
whole as a last resort. It noted that phones no longer show "Household
paused"; that is kept as a decision, for the reasons under [PD-rows].

A third round found that the test guarding the hidden panel only caught rules
with two ids, while one id and one class could also show every hidden tool;
hiding is now marked important and the test checks that instead. It also
found the list floor added blank space to the Walls and Room tools and
measured 60 pixels, not 52, because it sat inside the padding; the floor now
applies only where there is a list and counts the padding.

## Slices

* **[PD-slice-dock]** All of the above, in one slice.
