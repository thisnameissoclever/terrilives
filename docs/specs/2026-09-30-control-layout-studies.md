# Desktop and mobile control layout studies

Status: the owner selected the compact revision and authorized implementation,
adversarial review, merge and deployment on 2026-09-30. The original concept
images below record the design discussion; the implementation contract follows
at the end of this document. Traits starts closed and selected Sim names have
stronger typography.

The design keeps frequent controls reachable while preserving an uninterrupted
game view for selecting people and furniture.

## Directions

Each image presents one direction at both desktop and phone proportions.
Names, controls, furniture and the dark blue-accented palette are grounded in
the existing build. Illustrative state values are not new mechanics or balance
changes. These are visual concepts, not interactive prototypes.

1. [Household console](../assets/control-layout-studies/household-console.png)
2. [Slim dock + inspector](../assets/control-layout-studies/slim-dock-inspector.png)
3. [Context tray](../assets/control-layout-studies/context-tray.png)

The [design briefs](../assets/control-layout-studies/briefs.md) record the
intended dimensions and behavior. The images illustrate those directions;
their touch targets and geometry still need validation during implementation.

| Direction | Desktop | Mobile | Tradeoff |
| --- | --- | --- | --- |
| Household console | A broad bottom panel groups household selection, needs, current action and speed. | A shallow bottom sheet expands for detail. | Frequent information stays visible, but the desktop panel takes more height. |
| Slim dock + inspector | Speed, household selection and Build move to a thin bottom dock; the left inspector holds the selected person's details. | A compact bottom bar opens a full-width detail sheet. | Smaller change to desktop habits; mobile details take another tap. |
| Context tray | A bottom tray switches between Needs, Actions and People. | The same tabs occupy a bottom sheet with compact and expanded states. | More room for the house; fewer types of detail visible together. |

## Compact revision

The owner preferred the household console but found all three original
directions too large. The revised concept separates the selected person's
information at the bottom from world controls and preferences at the left.
The owner approved this direction for implementation.

[Latest compact mock-up](../assets/control-layout-studies/compact-household-console-v2.png)

This revision supersedes the three original directions for further discussion.
Its [revision briefs](../assets/control-layout-studies/compact-revision-briefs.md)
record the intended sizes and the second pass to reduce excess space.

1. Desktop targets a 96px bottom strip at a 1440 by 900 viewport, about 11%
   of its height. Household selection, current activity and mood share one
   group; seven need meters occupy two compact rows. Queue, People and Traits
   open detail panels above the strip only when requested. Only one detail
   panel opens at a time. The strip can collapse further to an identity row.
2. A small upper-left control group holds time, funds, speed, Build and
   Options. It ends after those controls rather than occupying a full-height
   sidebar. Options holds Save, Load, Light, Sound and Help. New housemate
   moves behind household management rather than keeping a large button.
3. Desktop buttons target 32px height. Mobile keeps 44px tap areas in two
   compact bottom rows, with the full needs list and other details on demand.
   Phone world controls occupy a small left-edge group below a thin status
   strip. The detail sheet opens above the compact strip and closes explicitly; only
   one detail section appears at a time.
4. Remove portraits, duplicate activity labels, redundant section headings
   and excess padding before reducing readable type. Keep the selected name
   prominent. Urgent needs remain visible even when their detail is closed.

These are design targets. A generated image cannot prove the implemented
dimensions, hit targets, text enlargement behavior or canvas input clearance.
Those need measurement in the selected implementation.

## Requirements for a selected direction

1. Sim names remain prominent. Traits starts collapsed; a player's explicit
   expansion stays a presentation choice and never changes simulation state.
2. Pause, speed, household switching and Build remain easy to reach. Build
   replaces play controls with its tools and retains an obvious Exit build.
3. Reuse the existing controllers and DOM ownership where possible. Responsive
   layouts must not create separate, conflicting copies of simulation controls.
4. Mobile controls have at least 44px touch targets, visible focus, safe-area
   padding and a button alternative to every drag gesture. Labels stay literal.
5. Open only one large mobile detail surface at a time. Keep a substantial
   uninterrupted game area in the compact state and bound expanded sheets to
   the available height. Check 320 by 568, 390 by 844, short landscape and
   enlarged text before accepting the layout.
6. Object action menus must remain reachable without colliding with the dock.
   Save status and urgent feedback remain visible; warnings do not depend on
   opening a detail tab.
7. The owner selects or revises a direction before implementation. Any new
   authored voice text follows the existing owner review boundary.

See [the implemented UI evidence](../assets/review-evidence/sim-name-hierarchy/README.md)
for the current name styling and responsive checks.

## Implemented contract

### [CUI-world] World controls

Time, Funds and live status remain in the upper-left group, followed by speed,
Build and Options. The default group is 144px wide on desktop and 182px on
compact screens. Options contains Light, Death, Sound, Effects, Save, Load,
New game, New housemate and Help. Close Options, Escape and an outside press close it.
Opening Options closes the Sim sheet. Cancelling Load or New game returns
stranded keyboard focus to the visible Options button and releases that
dialog's pause. New housemate also closes Options and restores stranded focus
to its visible toggle when dismissed. A confirmed storage operation retains ownership until it
settles; neither path steals focus deliberately moved elsewhere. No game
command is issued by opening a panel.

Build gives every desktop tool a 304px outer panel. At the Build breakpoint
(700px width or 480px height), Options joins zoom in the upper-right controls.
When contextual rows need the short-screen grid, the same world controls move
into its header and retain focus. The Sim dock keeps its separate breakpoint.

### [CUI-dock] Compact Sim dock

The bottom dock shows the selected name, activity, mood, life satisfaction,
household roster and,
on desktop, all seven need meters. Household death warnings remain in a live status row even when another Sim is
selected or the roster is collapsed. Critical needs replace the activity summary
with an explicit warning in every layout, including a collapsed dock. Sim
names are 20px on desktop and 18px on compact screens; roster names are bold.
Mood has a bold value and meter in the main header, beside life satisfaction.
The dock measures about 90px high at 1280 by 800 with ordinary names and 117px
at 800 by 700. Compact screens use a separate two-column wellbeing row; the
dock measures about 137px at 390 by 844. Content and warnings can increase
these heights. The original implementation measured 89px and 104px before
these values moved into the dock.

Collapse folds the roster and need meters; mood and life satisfaction remain
visible. Sim details
remains available. The same needs DOM moves into Overview when compact or
collapsed, so folding never removes access to the meters. Compact mode uses
the existing breakpoint: width at most 600px or height at most 480px. Desktop
buttons may be 32px; touch controls remain at least 44px tall. Household members
scroll horizontally when they do not fit.

### [CUI-details] Complete control access

| Control or information | Desktop route | Compact route |
| --- | --- | --- |
| Pause and speed | World group | World group |
| Build and all five tools | Build | Build |
| Light, Death, Sound, Effects, Save, Load, New game, Help | Options | Options |
| Select household member | Dock roster | Dock roster |
| Mood and life satisfaction | Main dock | Main dock |
| Needs, moodlets, career, activity, waiting count | Sim details / Overview | Sim details / Overview |
| Queue preview, Queue mode, Clear orders | Queue | Sim details / Queue |
| Relationships and family ties | Sim details / People | Sim details / People |
| Traits and self-preservation | Sim details / Traits | Sim details / Traits |
| New housemate, including with no selected Sim | Options | Options |

One detail section appears at a time. The desktop sheet starts at 360 pixels
wide, expanding to 540 pixels while Overview's personality disclosure is
open. Compact screens use the available width. The sheet scrolls within the
available height; its navigation wraps to keep every tab reachable. Traits starts
closed on every load and opens only when requested. Close and Escape return
focus to a visible opener. Native dialogs and the object action menu take
Escape before the Sim sheet. Sim details contains Overview, Queue, People and
Traits; household creation belongs to Options, not the selected person.

Queue remains a bounded upcoming-action preview, not a full queue editor.
Its note explains that orders beyond the visible prefix remain queued.
Opening Queue invalidates its capacity measurement so it immediately fills
the newly visible area. Existing simulation commands and panel controllers
remain the data owners; responsive layouts do not duplicate action controls.

### [CUI-build] Build mode and placement

Build hides the Sim dock and speed controls, pauses the household through the
existing controller, and retains Exit build and Options. Desktop Build uses
the left panel; compact Build uses the bottom dock at width <=700px or height <=480px, independently of the Sim dock breakpoint. Desktop Build tools have a fixed 304px outer width. Leaving
Build restores the prior Sim sheet/collapse state while retaining any viewport
change. Placement buttons avoid the left world group and the bottom Build
dock, including by moving to the right when there is no room below. All five tools now share the surface described in [contextual build controls](2026-10-01-build-context-controls.md). Shortcuts is optional and starts collapsed.

See [implementation evidence](../assets/review-evidence/compact-hud/README.md)
for checks, screenshots and adversarial review results.

See [dock wellbeing evidence](../assets/review-evidence/dock-wellbeing/README.md)
for the follow-up layout, control-access and enlarged-text checks.
