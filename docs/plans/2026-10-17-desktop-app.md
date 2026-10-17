# Desktop app and multithreading: research for later

Status: research record, written 2026-10-17 for issue 276. Nothing in this document is built or scheduled. The only part of issue 276 that shipped is the version number at the top of the Options panel.

The owner asked to "document all of this information for later consideration, including how we can later add multi-thread support in an installable desktop application version, which will eventually be critical." This document records what the project's documents already planned, the browser limits in today's code, what an installed app would change, the shell options, and the routes to a multithreaded simulation.

Two kinds of fact appear here. A statement that names a file was checked against the repository when this document was added. A statement that begins "Reported (2026-10-17):" came from outside research and was not verified in this repository; recheck it before acting on it, because browser engines, web views and app frameworks change quickly. External version numbers appear only where the repository itself pins them.

## Contents

- [The owner's decisions](#the-owners-decisions)
- [What the project's documents planned](#what-the-projects-documents-planned)
- [Browser limits in the code today](#browser-limits-in-the-code-today)
- [What an installed app would add and cost](#what-an-installed-app-would-add-and-cost)
- [Shell options compared](#shell-options-compared)
- [Recommendation](#recommendation)
- [Multithreading in a desktop build](#multithreading-in-a-desktop-build)
  - [Determinism requirements every path keeps](#determinism-requirements-every-path-keeps)
  - [Path A: wasm threads inside a desktop shell](#path-a-wasm-threads-inside-a-desktop-shell)
  - [Path B: a native simulation process](#path-b-a-native-simulation-process)
  - [Path C: a web host that sends COOP and COEP](#path-c-a-web-host-that-sends-coop-and-coep)
  - [The paths side by side](#the-paths-side-by-side)
- [Decisions still open](#decisions-still-open)

## The owner's decisions

These were recorded from issue 276 on 2026-10-17.

1. The first version is 1.0.0, shown as "Version 1.0.0" at the top of the Options panel.
2. Installers, when they come, will be unsigned.
3. Installers are deferred. Issue 276 adds no installer, no release workflow and no dependency.
4. Multithreading in an installable desktop version "will eventually be critical".

The version number is typed once, in `web/package.json`. Vite reads that file when it starts and replaces `__APP_VERSION__` in the bundle with the quoted number (`define` in `web/vite.config.ts`). At startup `web/src/ui/game-version.ts` writes "Version" and the number into the empty `#game-version` line in `web/index.html`. The Rust workspace version in the root `Cargo.toml`, which all four crates inherit, must match; `web/tests/game-version.test.ts` fails when `package.json`, the npm lockfile, `Cargo.toml`, `Cargo.lock` or the README's Version line disagree. A version bump therefore edits `package.json`, the root `Cargo.toml` and the README line together and refreshes both lockfiles; the test names any copy left behind. A desktop shell can read the same `package.json` field for its own app version, so it adds no further copy.

## What the project's documents planned

The project chose the web first without ruling out a desktop build.

- `docs/ARCHITECTURE.md`, Summary of decisions, lists the later shell as "Native desktop, as a shell swap rather than a rewrite". The repository layout in [D1] reserves `terri-native/` as the "(later) native shell entry point". That crate does not exist; the workspace members are `terri-core`, `terri-data`, `terri-sim` and `terri-wasm`.
- [A1] keeps the simulation a pure library with no engine types, which reduces "an engine swap to a shell rewrite". [D1] requires that `terri-core`, `terri-data` and `terri-sim` contain no `wasm-bindgen` and no `web-sys`. Those three crates already compile and run natively under `cargo test`, which is the precondition for a native simulation.
- `docs/TECH_STACK.md`, under One source, two targets, says the same Rust "compiles to WASM today and to a native binary later", so the native build "becomes a shell project rather than a rewrite". The same document names the DOM user interface as the stack's decisive advantage.
- `docs/FEATURES.md`, under Explicitly out of scope for v1, lists "Native desktop build" as "Shell swap, deferred by choice, not blocked".
- [A9] plans a job system: need decay, utility scoring and path requests are parallel across agents. [D4] states that the alpha "explicitly configures `ExecutorKind::SingleThreaded`" and that [A9] "remains a scale plan rather than shipped behavior". A parallel schedule must first follow [D4]'s commutativity rule, described under [Determinism requirements every path keeps](#determinism-requirements-every-path-keeps). Risk [R2] tracks the hazard.
- `docs/TIM-TODO.md` [T18] says "The web build needs COOP/COEP headers for WASM threads, so whatever you pick must let you set response headers." COOP (Cross-Origin-Opener-Policy) and COEP (Cross-Origin-Embedder-Policy) are HTTP response headers. Together they make a page cross-origin isolated: it loads no cross-origin resource that has not opted in and keeps no window link to other sites' pages. Browsers offer `SharedArrayBuffer`, the shared memory that wasm threads use, only in that state.
- `.github/workflows/pages.yml` records the conflict: GitHub Pages "cannot set response headers, so it cannot send COOP and COEP", and the day [A9] lands "this host stops being sufficient".
- `web/vite.config.ts` already sends both headers from the dev server on port 5174 and the preview server on port 4173, with the note "Required for SharedArrayBuffer / WASM threads later. Harmless now." The published site cannot send them.
- `docs/TECH_STACK.md`, under The memory picture, says "wasm32 caps at a 4GB address space, with ~2GB the safe number for broad device support". Simulation state at the town scale target is estimated in tens of megabytes; art is the real memory budget ([R4]).
- The `docs/TECH_STACK.md` stack table lists save storage as OPFS, the Origin Private File System that a browser keeps privately for one site, with "Worker-owned file handles, subject to browser storage quotas and deletion".

## Browser limits in the code today

1. The simulation is single-threaded. `crates/terri-sim/src/lib.rs` sets `ExecutorKind::SingleThreaded` on both the full tick schedule and the paused command-drain schedule; the comment says parallelism "is [A9]/[D4] and requires the commutativity rule". The simulation steps on the page's main thread inside the `requestAnimationFrame` loop in `web/src/main.ts`, alongside rendering and the DOM interface. The existing workers handle saves, character preparation and bike contact compilation, not simulation.
2. There is no shared memory. Nothing in `web/src` uses `SharedArrayBuffer` or `Atomics`. `web/src/render/instances.ts` types instance arrays over a plain `ArrayBuffer`, so a shared buffer passed to `GPUQueue.writeBuffer` would be a type error "if WASM threads ever land".
3. The save has no safety net outside the browser. `web/src/storage/save-worker.ts` keeps one slot, `terri-save-1.bin`, and a recovery copy for each older save format, all in OPFS. The code never calls `navigator.storage.persist()`, so the browser may evict the save under storage pressure, and clearing the site's data deletes it. There is no export or import, so a player cannot back up a save or move it to another browser or computer.
4. WebGPU limits come from the graphics adapter. `web/src/render/device.ts` requests the adapter's own `maxTextureDimension2D`, and the atlas code in `web/src/render/architecture-atlas.ts` and `web/src/render/architecture-finishes.ts` checks texture sizes and storage-buffer bindings against the device's limits. A desktop shell built on a browser engine reports the same adapter limits, so it does not lift them.
5. A hidden tab stops the game. The frame loop runs on `requestAnimationFrame`, which a hidden tab does not fire ([L14]), so simulated time does not pass. `web/src/main.ts` saves when the page becomes hidden and marks audio as backgrounded.
6. Sound waits for a gesture. `web/src/audio/audio-controller.ts` starts and resumes the audio context only inside a trusted pointer or keyboard handler, because browsers block audio that starts without one.
7. The startup failure advice is stale. When WebGPU is missing, `web/src/ui/startup-failure.ts` tells the player "Recent Chrome or Edge works everywhere; Safari 18 and Firefox are getting there." Browser support has moved since that text was written. Replacing it is a separate copy change under the review boundary in `docs/player-visible-strings.md`.
8. The production build is large. `npm run build` on this branch on 2026-10-17 produced a `web/dist` folder of 363 MB, measured with `du -sh web/dist` on a Windows 11 workstation. A browser fetches what the game loads; an installer would carry all of it.

## What an installed app would add and cost

An installed app would add these:

1. Saves as ordinary files in the player's profile folder, outside browser quotas and site-data clearing. A player could copy, back up and move them.
2. Control of response headers. The shell serves the game to its own web view, so it can make the page cross-origin isolated without a web host's help (Path A below).
3. A choice about background behavior. Reported (2026-10-17): Electron can turn off background throttling for a window, so the game could keep time while minimized. Whether it should is an open decision.
4. Sound without a first gesture. Reported (2026-10-17): Electron accepts an autoplay policy that removes the gesture requirement.
5. Offline play, a desktop icon and, with Electron, a browser engine version chosen by the project rather than by each player's browser.
6. A route past the 4 GB wasm32 address space, but only through a native simulation (Path B). A shell that runs the same wasm keeps the same limit.

It would cost these:

1. A release pipeline that does not exist: builds for each operating system, installers, update delivery and continuous integration for all of them.
2. Warnings for unsigned installers. Reported (2026-10-17): Windows SmartScreen warns about unsigned downloads from a publisher without reputation; macOS Gatekeeper blocks apps that are not signed with an Apple Developer ID and notarized, so the player must approve the app in System Settings; Apple silicon Macs refuse native code with no signature at all, so builds need at least an ad hoc signature; and automatic updates on macOS generally require a signed app.
3. Installer size and upkeep. Electron ships its own Chromium and Node.js with every installer and needs a new release whenever Chromium needs a security fix. Tauri uses the operating system's web view and is much smaller.
4. A second runtime to verify. The played visual passes in `docs/testing-protocol.md` section 9 and the audio checks would need repeating in the shell.
5. Save transfer. A player with a browser save needs a way to bring it across, which needs the export and import the web build lacks.

## Shell options compared

A shell here is the program that opens a window and hosts the game. The first three options keep the TypeScript renderer and DOM interface; the fourth replaces them.

| Option | What it is | WebGPU | Shared memory for threads | Saves | Main cost |
| --- | --- | --- | --- | --- | --- |
| Electron | Chromium and Node.js packaged with the app, running the existing web build | Chromium's, at the version the project ships | The shell can send COOP and COEP itself | Files, through a small bridge from the page to Node.js | Installer size; shipping Chromium security updates |
| Tauri 2 | A Rust app hosting the operating system's web view: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux | Depends on each web view. Reported (2026-10-17): WKWebView offers WebGPU only from macOS 26. Linux support was not established | Reported (2026-10-17): settable through the shell's custom protocol; behavior differs by web view | Files, written by Rust commands | Three browser engines to test; a macOS minimum for WebGPU |
| Installable progressive web app | The browser offers Install from a web app manifest and service worker; the game still runs in the browser | The player's browser | Still needs a host that sends COOP and COEP (Path C) | OPFS, with the same quotas and deletion | Lifts almost none of the browser limits above |
| Native Rust port | winit, a Rust windowing library, with wgpu, a Rust implementation of the WebGPU interface over Vulkan, Metal and Direct3D 12 | Native, through wgpu | Native threads; no wasm limit | Files | Rewrites the renderer and the whole DOM interface |

## Recommendation

Use Electron for the first installers. It runs the existing web build in a known Chromium, so WebGPU behaves as it does in Chrome on the same computer; the shell can send COOP and COEP itself; and saves can become ordinary files through a small bridge. Its costs are installer size and keeping Chromium current.

Choose Tauri 2 instead if the goal becomes a native Rust simulation (Path B). Its Rust side can run `terri-sim` natively beside the web view, at the cost of testing three web view engines and, as reported on 2026-10-17, requiring macOS 26 for WebGPU on macOS.

An installable progressive web app is a cheap interim step, but it lifts almost none of the browser limits. A native Rust port contradicts the documented plan of "a shell swap rather than a rewrite" and gives up the DOM interface; it is not recommended.

## Multithreading in a desktop build

Three paths lead to a simulation that uses more than one processor core. They can combine: Path A with Path C gives the desktop app and the browser one threaded wasm build.

### Determinism requirements every path keeps

Determinism means the same starting world and the same player commands always produce the same world, on every machine and every build. Replayable bug reports, cheap saves and planned Layer 2 multiplayer depend on it ([A5]).

1. One seeded random source. `SimRng` in `crates/terri-core/src/rng.rs` is an in-house PCG generator, kept out of third-party crates so a dependency update cannot change its sequence; its state is saved and hashed. Systems draw from it in a fixed order; [D5]'s wandering step, for example, processes sims in entity-index order before its draws. No wall-clock reads inside simulation code ([A5]). A parallel system must never draw from `SimRng` concurrently.
2. [D4]'s commutativity rule: "Parallel systems must be commutative. Each entity's update reads only its own components plus immutable shared state. Anything genuinely contended (two sims reaching for one chair) goes through a serialized phase over a command buffer sorted by entity ID."
3. Thread count is never an input. A result must not depend on how many workers exist or which finishes first. Parallel reductions must combine partial results in a fixed order, because floating-point addition gives different results in different orders.
4. The world hash stays the referee. `Sim::world_hash` sorts its rows so archetype layout and entity history cannot change it ([L6]). Golden vectors assert that native and wasm32 builds produce identical digests ([L13]). A threaded build must reproduce the same golden hashes with one thread and with many, natively and in wasm.
5. Determinism tests pin golden values. [L5] records that a determinism test which runs twice in one process tests nothing.
6. The toolchain stays pinned. `rust-toolchain.toml` explains that a compiler bump is a deliberate commit of its own, followed by rerunning the golden vectors on both targets.

### Path A: wasm threads inside a desktop shell

The shell keeps running the wasm simulation and turns on wasm threads.

1. Cross-origin isolation from the shell. The shell serves the game with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, the values `web/vite.config.ts` already sends in development, so `SharedArrayBuffer` exists. Every resource the page loads must then come from its own origin or carry permission headers; check the production build for any cross-origin request before relying on this.
2. A wasm build with atomics. The pinned toolchain in `rust-toolchain.toml` (stable `1.94.1`, target `wasm32-unknown-unknown`, profile `minimal`) cannot produce one as configured. Reported (2026-10-17): the standard library shipped for `wasm32-unknown-unknown` is compiled without atomics, so a threaded build must rebuild it with `-Z build-std` and target features including `+atomics` and `+bulk-memory`, which needs a nightly compiler and the `rust-src` component. The repository would need a pinned nightly used only for the threaded wasm build, or a move of the whole pin to a dated nightly; the `rust-src` component; a separate `wasm-pack` invocation with those flags; and a fresh run of the golden vectors on the new compiler. Two compilers producing shipped code is a determinism risk the vectors must cover.
3. A threaded scheduler. One option is `bevy_ecs`'s multi-threaded executor; reported (2026-10-17), Bevy's task pools run on a single thread on wasm32, so that must be verified before it is chosen. The other is a rayon-style job pool used inside individual systems, splitting entities into fixed chunks by entity index and merging results in index order; reported (2026-10-17), `wasm-bindgen-rayon` provides such a pool for the browser. Contended actions stay in a serialized phase sorted by entity ID, as [D4] requires.
4. The simulation leaves the main thread. Reported (2026-10-17): browsers do not let the main thread block on `Atomics.wait`, so a threaded simulation would run in a worker. The renderer could still read [D11]'s typed-array views over shared memory, but it would need a fence or a double buffer so it never reads a half-finished tick.

Path A keeps most of [D11]'s zero-copy bridge and can share one build with the browser if Path C also lands. It keeps the 4 GB wasm32 address space, and, as reported above, it adds a nightly compiler to the build.

### Path B: a native simulation process

Path B creates the reserved `terri-native` crate: a native program or library that runs `terri-sim` with ordinary operating-system threads, hosted by the shell's native side (Tauri's Rust core, or a helper process beside Electron). The web view keeps rendering and the DOM interface. Player commands travel to the simulation as postcard bytes, the wire format `terri-wasm` already decodes, and render state returns as messages.

Path B gives native threads without a nightly compiler or a rebuilt standard library, removes the wasm32 address-space limit from simulation memory, and lets Rust write saves as ordinary files. It replaces [D11]'s zero-copy views with a copy across a process boundary on every frame, so the frame-time budgets behind [R1] need new measurements. It also leaves two simulation builds, wasm for the web and native for the desktop, which must keep identical golden hashes ([L13]). The browser version stays single-threaded unless Path A and Path C also land.

### Path C: a web host that sends COOP and COEP

Path C moves the published web build to a host that sets response headers, as [T18] anticipated, so the browser version becomes cross-origin isolated and can load the same threaded wasm as Path A. Reported (2026-10-17): a service worker can add COOP and COEP to the responses it serves on a host that cannot set headers, at the cost of a reload on the first visit and the service worker's own failure cases; that would let GitHub Pages stay, but it is a workaround to test, not a decision. Cross-origin isolation also stops the page from loading cross-origin resources that do not opt in, and COOP cuts the link between the page and windows it opens. The Changelog link already opens its tab with `rel="noopener"`, so it does not rely on that link.

### The paths side by side

| Path | Threads in the desktop app | Threads in the browser | Lifts the 4 GB wasm32 limit | Keeps the zero-copy bridge | Toolchain change |
| --- | --- | --- | --- | --- | --- |
| A | Yes | Only with Path C | No | Mostly; needs a tick fence | Nightly compiler and rebuilt standard library (reported) |
| B | Yes, native threads | No | Yes, for the desktop simulation | No | None for the native build |
| C | Not applicable | Yes, with Path A's build | No | As Path A | As Path A |

Path A with Path C gives one threaded build everywhere. Path B gives the desktop app the most room and leaves the browser as it is.

## Decisions still open

1. [DA-signing] Signing accounts and their costs, if unsigned installers draw too many warnings or support requests: a Windows code-signing certificate and the Apple Developer Program. No prices are recorded here.
2. [DA-identity] Product name and app identifier. [T1] in `docs/TIM-TODO.md` settled "Natural Causes" as the title and kept `terrilives` in storage keys and save fingerprints. An installer also needs a stable app identifier, usually in reverse domain form, because Windows and macOS key app data and updates on it.
3. [DA-save-transfer] Save transfer between the web and desktop versions: an export and import file, its format version, and what happens when both copies have changed.
4. [DA-macos-minimum] The minimum macOS version, which the chosen shell's WebGPU support bounds; reported (2026-10-17), macOS 26 for Tauri.
5. [DA-web-host] The web host: stay on GitHub Pages without COOP and COEP, try the service-worker workaround, or move to a host that sets headers ([T17], [T18]).
6. [DA-shell] Electron or Tauri 2, decided when installer work starts.
7. [DA-threads] Which multithreading path, and whether the browser version must be threaded too.
8. [DA-linux] Whether Linux is a target, given that WebGPU in WebKitGTK was not established by this research.
9. [DA-background] Whether simulated time passes while the desktop window is minimized.
