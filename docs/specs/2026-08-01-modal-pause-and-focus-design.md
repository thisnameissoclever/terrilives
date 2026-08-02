# Modal pause and focus design

Status: implemented and verified in visible Chromium on desktop and mobile.

## Problem

The page started at 1x and continued advancing while first-run Help, Load, or
New game confirmation was open. One simulated day lasts about 2.4 real
minutes, so reading nine onboarding instructions could consume several game
hours before the player issued a first order. First-run Help also left focus
behind the overlay; manual Help focused its final button, which could scroll a
small screen past the instructions.

## Contract

1. Help, Load confirmation, and New game confirmation stop the fixed-step
   driver for their complete ownership interval.
2. This is a shell-only suspension. It does not send a replayable `SetSpeed(0)`
   command because time spent reading browser UI is not simulated player time.
3. The last speed chosen by the player remains selected and resumes only after
   the final blocking surface closes.
4. Help is a native modal dialog. Opening it scrolls to the first instruction
   and focuses the `How to play` heading. Closing with Got it or Escape returns
   focus to the Help button, or to the game canvas after automatic first-run
   Help.
5. Confirmed Load stays suspended until the storage operation and world swap
   settle. Confirmed New game stays suspended until reload or a failed clear.
6. The guide states that game time is paused so the visible 1x selection is not
   mistaken for a running clock.

## Verification

Unit tests cover selected-speed restoration, overlapping modal owners,
idempotent lifecycle calls, first-run storage behavior, scroll reset, and focus
placement. Visible Chromium checks cover:

1. First-run Help held `Day 1, 00:00` unchanged for more than one second and
   focused `#help-title`.
2. Got it resumed at 1x and focused `#stage`.
3. Manual Help closed with Escape, restored focus to `#show-help`, and resumed
   the clock.
4. New game confirmation held its clock value unchanged for more than one
   second, then resumed only after Keep playing.
5. The Help dialog fit a 390 x 844 viewport with the full instruction list and
   44-pixel Got it control visible.
