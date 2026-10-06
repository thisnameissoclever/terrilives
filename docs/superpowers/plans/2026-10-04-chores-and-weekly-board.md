# Chores and Weekly Board Implementation Plan

> Use the executing-plans skill for inline implementation with one final independent review. The owner authorized continuing without staged approval waits.

**Goal:** Add persistent household dirt, varied chore behavior and an automated weekly chores board.

**Architecture:** A shared chores resource owns mess, profiles, claims and commitments. Timed chore work reuses the existing path mover and player order queue. Existing dishes remain in domestic state and publish real completion to the board.

**Tech stack:** Rust simulation and saved state; WebAssembly boundary; TypeScript browser controls and renderer.

**Spec:** `docs/specs/2026-10-04-chores-and-weekly-board.md`.

## Global constraints

1. Keep every existing command tag and published nested save layout.
2. Add no dependencies. Preserve player order priority and deterministic randomness.
3. Use stable SimIds for profiles and duties. Read copied boundary projections before zero-copy views.
4. Keep the full goal intact; the board is the final milestone, not a substitute for real chores.

## Review focus

1. Save during interruptions, week changes and daily decisions must retain claims and decisions.
2. Dirt cannot turn painted floors into a different covering or appear in the yard.
3. A helper, absent owner or clean day must not generate false fulfillment or resentment.
4. Furniture and room changes cannot strand an infinite chore or duplicate an assignment.
5. Keyboard and touch controls must reach the same scoped commands as pointer menus.

## Task 1: Chore state and behavioral model

- [x] Add typed chore keys, profiles, dirt and work records in an appended V5 field.
- [x] Write failing tests for floor aging, preference and responsibility independence, daily probabilities and causal hashing.
- [x] Implement deterministic bounded state transitions and legacy defaults.
- [x] Run native targeted tests, wire fixtures and save-tail boundary tests.

## Task 2: Actual chores and order integration

- [x] Add scoped front/back chore commands and queue persistence.
- [x] Reuse room regions and the existing path mover for timed floor, surface and bin work.
- [x] Add waste and surface consequences to real food-preparation transitions.
- [x] Test claims, interruption, cancellation, unreachable work and conservation.

## Task 3: Presentation and controls

- [x] Add authoritative dirt and work projections to the browser bridge.
- [x] Show grime while preserving floor materials and depth.
- [x] Add literal context actions and keyboard targets; retain dish semantics.
- [x] Expose responsibility, history and chore preferences with validated edits.
- [x] Verify actual browser cleanup and responsive controls.

## Task 4: Weekly board and interpersonal outcomes

- [x] Add balanced preference-weighted weekly assignments and saved daily opportunities.
- [x] Connect actual dish and other chore completion to performer credit.
- [x] Settle daily commitments and bounded mood/relationship reactions once.
- [x] Build the Chores panel and test roster, week and target changes through save/load.

## Task 5: Full verification and delivery preparation

- [x] Perform invariant fault tests and restore source byte-identically.
- [x] Run native workspace, release boundary, web, type, lint, build and changelog gates.
- [x] Obtain one fresh independent review and fix actionable findings with regression tests.
- [x] Update maintained docs, lessons and the delivery-date public changelog.
- [x] Preserve evidence and close task-owned browser pages and preview servers.
