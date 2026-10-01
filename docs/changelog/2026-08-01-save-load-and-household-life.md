# Save progress and direct a household

The playable alpha gains persistence, accessible household controls, relationships, life satisfaction, careers and multi-step activities.

## Features & changes
- **Save and resume a household.** Save, Load, New game and daily autosave use one browser-local save slot. First-run Help explains the controls. [PR #25](https://github.com/thisnameissoclever/terrilives/pull/25)
- **Select every housemate and inspect relationships.** The accessible roster supports up to six people, and People shows how the selected person feels about the others. [PR #26](https://github.com/thisnameissoclever/terrilives/pull/26) and [PR #29](https://github.com/thisnameissoclever/terrilives/pull/29)
- **Hobbies, traits and work affect life.** Life satisfaction, trait effects, an office work schedule, wages, the day clock and household Funds are added. [PR #19](https://github.com/thisnameissoclever/terrilives/pull/19), [PR #20](https://github.com/thisnameissoclever/terrilives/pull/20) and [PR #21](https://github.com/thisnameissoclever/terrilives/pull/21)
- **Activities can have several steps.** Cooking and related errands use stations and carried items, with visible activity information and continuation after interruption. [PR #22](https://github.com/thisnameissoclever/terrilives/pull/22), [PR #23](https://github.com/thisnameissoclever/terrilives/pull/23) and [PR #24](https://github.com/thisnameissoclever/terrilives/pull/24)
- **Use pointer, touch or keyboard controls.** Pan and anchored zoom, long-press actions, Queue mode and keyboard world targeting are available. [PR #18](https://github.com/thisnameissoclever/terrilives/pull/18) and [PR #25](https://github.com/thisnameissoclever/terrilives/pull/25)

## Bug fixes
- **Persistence operations cannot overwrite one another.** Save and load operations are serialized, and failed loads retain the current game. The alpha acceptance pass also corrects saving, at-work need drain and unused reading-chair behavior. [PR #28](https://github.com/thisnameissoclever/terrilives/pull/28) and [PR #27](https://github.com/thisnameissoclever/terrilives/pull/27)

