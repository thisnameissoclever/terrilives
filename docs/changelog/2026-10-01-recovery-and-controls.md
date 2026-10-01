# Sound recovery and steadier controls

Sound recovers more reliably after browser interruptions, and household controls and personal details are easier to use.

## Bug fixes
- **Interrupted audio stays stopped.** Sounds and fading recordings are cleared when the browser interrupts audio, including while game time is paused. Old sounds cannot resume later after their activity has ended. [PR #185](https://github.com/thisnameissoclever/terrilives/pull/185)
- **Audio can recover automatically.** When the browser makes audio available again, active activities can regain their sound without requiring another click. Stopping a sound also clears it when the browser's audio clock is suspended. [PR #181](https://github.com/thisnameissoclever/terrilives/pull/181) and [PR #180](https://github.com/thisnameissoclever/terrilives/pull/180)
- **New housemate controls have more room.** Form controls remain readable and usable on narrow screens and with larger text. Closing a dialog returns keyboard focus to the control that opened it. [PR #176](https://github.com/thisnameissoclever/terrilives/pull/176) and [PR #174](https://github.com/thisnameissoclever/terrilives/pull/174)
- **Personal details keep unchanged text in place.** Regular refreshes no longer replace text that has not changed. Updated values still appear when they change. [PR #187](https://github.com/thisnameissoclever/terrilives/pull/187)
- **Floor selection previews stay visible.** The floor tool draws the full selected tile, and its instructions switch between desktop and phone controls when the window size changes. [PR #191](https://github.com/thisnameissoclever/terrilives/pull/191)
- **Changing furniture leaves less unused simulation data behind.** Repeated household and furniture changes now clean up unused internal records instead of retaining them indefinitely. [PR #186](https://github.com/thisnameissoclever/terrilives/pull/186)

## Art & sound
- **Running sinks and cooking have recorded sound.** Sink use plays water audio, and stove cooking has its own cooking texture. [PR #175](https://github.com/thisnameissoclever/terrilives/pull/175) and [PR #183](https://github.com/thisnameissoclever/terrilives/pull/183)
