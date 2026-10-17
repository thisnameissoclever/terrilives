# Desktop app and multithreading: research for later

Status: research record, written 2026-10-17 while issue 276 was being worked. Nothing in this document is built or scheduled. Issue 276 asks for version numbers, with v1.0.0 as the default when no version is set, and for the number to be shown; for Mac and Windows installers; for a release mechanism and releases; and for a "local install" section in the README that explains how the installed game differs from the browser version. The change that added this document shipped only the version number, at the top of the Options panel. The installer, release and README requests remain open, so this change does not resolve the issue. [What an installed app would add and cost](#what-an-installed-app-would-add-and-cost) is groundwork for that README section.

In conversation on 2026-10-17, the owner said: "Ship only the version number now and display it at the top of the options panel. And document all of this information for later consideration, including how we can later add multi-thread support in an installable desktop application version, which will eventually be critical." This document records what the project's documents already planned, the browser limits in today's code, what an installed app would change, the shell options, and the routes to a multithreaded simulation.

Two kinds of fact appear here. A statement that names a repository file, test, lesson or tag was checked against the repository when this document was added. A statement that begins "Reported (2026-10-17):", or a table introduced that way, came from outside research and was not verified in this repository; recheck it before acting on it, because browser engines, web views and app frameworks change quickly. External version numbers, including a product's major version, appear only where the repository pins them or inside a reported statement or table.

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

Issue 276 asks for version numbers and gives v1.0.0 as the default "if version is not currently set". The decisions below came from the owner in conversation on 2026-10-17 and are not recorded in the issue, which had no comments when this document was written.

1. The first version is 1.0.0. Before this change the root `Cargo.toml` declared 0.1.0 and `web/package.json` had no version. Asked to choose, the owner chose 1.0.0, which matches the issue's default. The owner asked for the number at the top of the Options panel; the wording "Version 1.0.0" is the implementer's.
2. Installers, when they come, will be unsigned.
3. Installers are deferred. This change adds no installer, no release workflow and no dependency.
4. Multithreading in an installable desktop version "will eventually be critical".

The version number is typed in `web/package.json`. Vite reads that file when it starts and replaces `__APP_VERSION__` in the bundle with the quoted number (`define` in `web/vite.config.ts`). At startup `web/src/ui/game-version.ts` writes "Version" and the number into the empty `#game-version` line in `web/index.html`. The Rust workspace version in the root `Cargo.toml` must match, and every workspace member must inherit it with `version.workspace = true`. `web/tests/game-version.test.ts` reads the member list from `Cargo.toml`, so a new crate is checked without editing the test. The same test fails when `package.json`, the npm lockfile, `Cargo.toml`, `Cargo.lock` or the README's Version line disagree. A version bump therefore edits `package.json`, the root `Cargo.toml` and the README line together and refreshes both lockfiles; the test names any copy left behind. A desktop shell should take its app version from the same `package.json` field rather than adding another copy. Reported (2026-10-17): Electron's app version comes from `package.json` by default, and Tauri's configuration can point its version at a `package.json` file.

## What the project's documents planned

The project chose the web first without ruling out a desktop build.

- `docs/ARCHITECTURE.md`, Summary of decisions, lists the later shell as "Native desktop, as a shell swap rather than a rewrite". The repository layout in [D1] reserves `terri-native/` as the "(later) native shell entry point". That crate does not exist; the workspace members are `terri-core`, `terri-data`, `terri-sim` and `terri-wasm`.
- [A1] keeps the simulation a pure library with no engine types, which reduces "an engine swap to a shell rewrite". [D1] requires that `terri-core`, `terri-data` and `terri-sim` contain no `wasm-bindgen` and no `web-sys`. Those three crates already compile and run natively under `cargo test`, which is the precondition for a native simulation.
- `docs/TECH_STACK.md`, under One source, two targets, says the same Rust "compiles to WASM today and to a native binary later", so the native build "becomes a shell project rather than a rewrite". The same document names the DOM user interface as the stack's decisive advantage.
- `docs/FEATURES.md`, under Explicitly out of scope for v1, lists "Native desktop build" as "Shell swap, deferred by choice, not blocked".
- [A9] plans a job system: need decay, utility scoring and path requests are parallel across agents. [D4] states that the alpha "explicitly configures `ExecutorKind::SingleThreaded`" and that [A9] "remains a scale plan rather than shipped behavior". A parallel schedule must first follow [D4]'s commutativity rule, described under [Determinism requirements every path keeps](#determinism-requirements-every-path-keeps). Risk [R2] tracks the hazard.
- `docs/TIM-TODO.md` [T18] says "The web build needs COOP/COEP headers for WASM threads, so whatever you pick must let you set response headers." COOP (Cross-Origin-Opener-Policy) and COEP (Cross-Origin-Embedder-Policy) are HTTP response headers. `.github/workflows/pages.yml` states that they "are required for SharedArrayBuffer, and therefore for WASM threads"; `SharedArrayBuffer` is the shared memory that wasm threads use. Reported (2026-10-17): together the two headers make a page cross-origin isolated, meaning it loads no cross-origin resource that has not opted in and keeps no window link to other sites' pages, and browsers offer `SharedArrayBuffer` only in that state.
- `.github/workflows/pages.yml` records the conflict: GitHub Pages "cannot set response headers, so it cannot send COOP and COEP", and the day [A9] lands "this host stops being sufficient".
- `web/vite.config.ts` already sends both headers from the dev server on port 5174 and the preview server on port 4173, with the note "Required for SharedArrayBuffer / WASM threads later. Harmless now." The published site cannot send them.
- `docs/TECH_STACK.md`, under The memory picture, says "wasm32 caps at a 4GB address space, with ~2GB the safe number for broad device support". Simulation state at the town scale target is estimated in tens of megabytes; art is the real memory budget ([R4]).
- The `docs/TECH_STACK.md` stack table lists save storage as OPFS, the Origin Private File System that a browser keeps privately for one site, with "Worker-owned file handles, subject to browser storage quotas and deletion".

## Browser limits in the code today

1. The simulation is single-threaded. `crates/terri-sim/src/lib.rs` sets `ExecutorKind::SingleThreaded` on both the full tick schedule and the paused command-drain schedule; the comment says parallelism "is [A9]/[D4] and requires the commutativity rule". The simulation steps on the page's main thread inside the `requestAnimationFrame` loop in `web/src/main.ts`, alongside rendering and the DOM interface. The existing workers handle saves, character preparation and bike contact compilation, not simulation.
2. There is no shared memory. Nothing in `web/src` uses `SharedArrayBuffer` or `Atomics`. `web/src/render/instances.ts` defines `InstanceArray` as `Float32Array<ArrayBuffer>`, so the TypeScript type checker rejects a `Float32Array` view over a `SharedArrayBuffer` wherever an instance array is expected. That check happens at compile time and was a deliberate choice in this code: its comment keeps casts off the render path so the check would catch a shared-buffer mistake "if WASM threads ever land".
3. The save has no safety net outside the browser. `web/src/storage/save-worker.ts` keeps one slot, `terri-save-1.bin`, and a recovery copy for each older save format, all in OPFS. `docs/TECH_STACK.md` records that this storage is "subject to browser storage quotas and deletion", and the code never calls `navigator.storage.persist()`, the request that asks a browser not to evict a site's storage. Reported (2026-10-17): without that grant a browser may evict the save under storage pressure, and clearing the site's data deletes it. There is no export or import, so a player cannot back up a save or move it to another browser or computer.
4. WebGPU limits come from the graphics adapter. `web/src/render/device.ts` requests the adapter's own `maxTextureDimension2D`, and the atlas code in `web/src/render/architecture-atlas.ts` and `web/src/render/architecture-finishes.ts` checks texture sizes and storage-buffer bindings against the device's limits. Reported (2026-10-17): a desktop shell built on a browser engine reports the same adapter limits, so it does not lift them.
5. A hidden tab stops the game. The frame loop runs on `requestAnimationFrame`, which a hidden tab does not fire ([L14]), so simulated time does not pass. `web/src/main.ts` saves when the page becomes hidden and marks audio as backgrounded.
6. Sound waits for a gesture. `web/src/audio/audio-controller.ts` starts and resumes the audio context only inside a trusted pointer or keyboard handler; `docs/TECH_STACK.md` describes the audio layer as "gesture-gated browser playback".
7. The startup failure advice may be stale. When WebGPU is missing, `web/src/ui/startup-failure.ts` tells the player "Recent Chrome or Edge works everywhere; Safari 18 and Firefox are getting there." Reported (2026-10-17): browser support for WebGPU has changed since that text was written. Replacing it is a separate copy change under the review boundary in `docs/player-visible-strings.md`.
8. The production build is large. After `npm run build` at commit `1ca74cd30` on 2026-10-17, `du -sh web/dist` reported 363 MB on a Windows 11 workstation. A browser fetches what the game loads; an installer would carry all of it.

## What an installed app would add and cost

An installed app would add these:

1. Saves as ordinary files in the player's profile folder, outside browser quotas and site-data clearing. A player could copy, back up and move them.
2. Control of response headers. Reported (2026-10-17): the shell serves the game to its own web view, so it can make the page cross-origin isolated without a web host's help (Path A below).
3. A choice about background behavior. Reported (2026-10-17): Electron can turn off background throttling for a window, so the game could keep time while minimized. Whether it should is an open decision.
4. Sound without a first gesture. Reported (2026-10-17): Electron accepts an autoplay policy that removes the gesture requirement.
5. Offline play and a desktop icon. Reported (2026-10-17): with Electron, the project rather than each player's browser chooses the browser engine version.
6. More memory headroom, by one of two routes. A native simulation (Path B) leaves the wasm32 address space behind. Reported (2026-10-17): 64-bit WebAssembly memory (Memory64) has shipped in Chromium and Firefox, but Rust's `wasm64-unknown-unknown` target is tier 3, with no prebuilt standard library, so a 64-bit wasm build is possible in principle and unsupported in practice. A shell that runs today's wasm32 build keeps the 4 GB limit.

It would cost these:

1. A release pipeline that does not exist: builds for each operating system, installers, update delivery and continuous integration for all of them.
2. Warnings for unsigned installers. Reported (2026-10-17): Windows SmartScreen warns about unsigned downloads from a publisher without reputation; macOS Gatekeeper blocks apps that are not signed with an Apple Developer ID and notarized, so the player must approve the app in System Settings; Apple silicon Macs refuse native code with no signature at all, so builds need at least an ad hoc signature; and automatic updates on macOS generally require a signed app.
3. Installer size and upkeep. Reported (2026-10-17): Electron ships its own Chromium and Node.js with every installer and needs a new release whenever Chromium needs a security fix, while Tauri uses the operating system's web view and produces much smaller installers. Electron's runtime adds roughly 80 to 100 MB compressed, which is small next to the 363 MB `web/dist` build measured above, so the game's own files are likely to outweigh the shell in any installer.
4. A second runtime to verify. The played visual passes in `docs/testing-protocol.md` section 9 and the audio checks would need repeating in the shell.
5. Save transfer. A player with a browser save needs a way to bring it across, which needs the export and import the web build lacks.

## Shell options compared

A shell here is the program that opens a window and hosts the game. The first three options keep the TypeScript renderer and DOM interface; the fourth replaces them.

Reported (2026-10-17): every cell in the table below comes from outside research, except two that describe this repository: the installable web app's OPFS save entry and the native port's main cost.

| Option | What it is | WebGPU | Shared memory for threads | Saves | Main cost |
| --- | --- | --- | --- | --- | --- |
| Electron | Chromium and Node.js packaged with the app, running the existing web build | Chromium's, at the version the project ships | The shell can send COOP and COEP itself | Files, through a small bridge from the page to Node.js | Installer size; shipping Chromium security updates |
| Tauri 2 | A Rust app hosting the operating system's web view: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux | Depends on each web view; WKWebView offers WebGPU only from macOS 26; Linux support was not established | Settable through the shell's custom protocol; behavior differs by web view | Files, written by Rust commands | Three browser engines to test; a macOS minimum for WebGPU |
| Installable progressive web app | The browser offers Install from a web app manifest and service worker; the game still runs in the browser | The player's browser | Still needs a host that sends COOP and COEP (Path C) | OPFS, with the same quotas and deletion | Lifts almost none of the browser limits above |
| Native Rust port | winit, a Rust windowing library, with wgpu, a Rust implementation of the WebGPU interface over Vulkan, Metal and Direct3D 12 | Native, through wgpu | Native threads; no wasm limit | Files | Rewrites the TypeScript renderer and the whole DOM interface |

## Recommendation

This recommendation rests on the reported facts in the table above and is only as current as they are.

Use Electron for the first installers. Reported (2026-10-17): it runs the existing web build in a known Chromium, so WebGPU behaves as it does in Chrome on the same computer, and the shell can send COOP and COEP itself. Saves can become ordinary files through a small bridge. Its costs are keeping Chromium current and installer size, although the reported 80 to 100 MB that Electron adds is small next to the game's own files.

Choose Tauri instead if the goal becomes a native Rust simulation (Path B). Its Rust side can run `terri-sim` natively beside the web view. Reported (2026-10-17): Tauri's current major version is 2, and the cost is testing three web view engines and requiring macOS 26 for WebGPU on macOS.

An installable progressive web app is a cheap interim step, but it lifts almost none of the browser limits. A native Rust port contradicts the documented plan of "a shell swap rather than a rewrite" and gives up the DOM interface; it is not recommended.

## Multithreading in a desktop build

Three paths lead to a simulation that uses more than one processor core. They can combine: Path A with Path C gives the desktop app and the browser one threaded wasm build.

### Determinism requirements every path keeps

Determinism means the same starting world and the same player commands always produce the same world, on every machine and every build. Replayable bug reports, cheap saves and planned Layer 2 multiplayer depend on it ([A5]).

1. One seeded random source. `SimRng` in `crates/terri-core/src/rng.rs` is an in-house PCG generator, kept out of third-party crates so a dependency update cannot change its sequence; its state is saved and hashed. Systems draw from it in a fixed order; [D5]'s wandering step, for example, processes sims in entity-index order before its draws. No wall-clock reads inside simulation code ([A5]). A parallel system must never draw from `SimRng` concurrently.
2. [D4]'s commutativity rule: "Parallel systems must be commutative. Each entity's update reads only its own components plus immutable shared state. Anything genuinely contended (two sims reaching for one chair) goes through a serialized phase over a command buffer sorted by entity ID."
3. Thread count is never an input. A result must not depend on how many workers exist or which finishes first. Parallel reductions must combine partial results in a fixed order, because floating-point addition gives different results in different orders.
4. The world hash stays the referee, but only for scenarios that exercise what changed. `Sim::world_hash` sorts its rows so archetype layout and entity history cannot change it ([L6]), and golden vectors assert that native and wasm32 builds produce identical digests ([L13]). Those vectors cannot show that threading is safe. The `sample_softmax` comment in `crates/terri-sim/src/systems/action.rs` and [L36] record that both golden world hashes come from one-candidate scenarios, and no parallel system exists for them to run, so a threaded build would match them whether or not its parallel systems were deterministic: the kind of test that cannot fail, which [L5] warns about. A threaded build needs new golden scenarios with many sims, contended objects and multi-candidate choices, each giving the same hash at one thread and at several thread counts, natively and in wasm.
5. Simulation code must not depend on a platform math library. A text scan of `terri-sim`'s non-test code at commit `10bf067c9` for `exp`, `hypot`, `powi`, `powf`, `ln` and the trigonometric functions found `exp` in `crates/terri-sim/src/systems/action.rs` (softmax weights, about line 296) and `crates/terri-sim/src/systems/autonomy.rs` (about lines 142 and 148); `hypot` in proximity checks in `crates/terri-sim/src/social_company.rs` and `crates/terri-sim/src/relationship_dynamics.rs` (about line 211); and `powi` in `crates/terri-sim/src/domestic.rs` (about line 114), `crates/terri-sim/src/media.rs` (seat ranking, about line 410) and `crates/terri-sim/src/skills.rs` (about line 39). [L36] records that `f32::exp` "is a platform libm call with no cross-target bit-identity guarantee". Golden vectors cannot police this. The `sample_softmax` comment says both golden world hashes are one-candidate scenarios that never depend on an `exp` result, and that a last-bit difference changes an outcome only when a draw lands within one unit in the last place of a bucket boundary, so a vector would catch drift only by chance. Any shipped native simulation therefore requires one pure-Rust math library, compiled into the simulation on every target including wasm32, or fixed-point arithmetic, for these calls. A vector-based check added on top must exercise multi-candidate softmax, off-axis `hypot` distances and contended parallel systems. Reported (2026-10-17): Rust's documentation describes the precision of these functions as non-deterministic, varying by platform and Rust version and possibly between calls in one run; a native build calls the operating system's math library for `exp` and `hypot`, while wasm32 compiles its own. Also reported: `powi` with a constant exponent, as in `domestic.rs` and `media.rs`, likely compiles to inline multiplication, and with a variable exponent, as in `skills.rs`, to the compiler's own runtime routine, so it is likely the same code on native and wasm32, though Rust does not promise its rounding.
6. Determinism tests pin golden values. [L5] records that a determinism test which runs twice in one process tests nothing.
7. The toolchain stays pinned. `rust-toolchain.toml` explains that a compiler bump is a deliberate commit of its own, followed by rerunning the golden vectors on both targets.

### Path A: wasm threads inside a desktop shell

The shell keeps running the wasm simulation and turns on wasm threads.

1. Cross-origin isolation from the shell. The shell serves the game with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, the values `web/vite.config.ts` already sends in development. Reported (2026-10-17): that makes `SharedArrayBuffer` available, and every resource the page loads must then come from its own origin or carry permission headers. Check the production build for any cross-origin request before relying on this.
2. A wasm build with atomics. The pinned toolchain in `rust-toolchain.toml` (stable `1.94.1`, target `wasm32-unknown-unknown`, profile `minimal`) cannot produce one as configured. Reported (2026-10-17): the standard library shipped for `wasm32-unknown-unknown` is compiled without atomics, so a threaded build must rebuild it with `-Z build-std` and target features including `+atomics` and `+bulk-memory`, which needs a nightly compiler and the `rust-src` component. The repository would need a pinned nightly used only for the threaded wasm build, or a move of the whole pin to a dated nightly; the `rust-src` component; a separate `wasm-pack` invocation with those flags; and a fresh run of the golden vectors on the new compiler. Two compilers producing shipped code is a determinism risk the vectors must cover.
3. A fixed memory ceiling. Reported (2026-10-17): shared wasm memory must declare its maximum size when the module is linked, so the threaded build's memory ceiling is chosen at build time and cannot grow past it at run time. The ceiling must cover the largest town the build supports, within the 4 GB wasm32 address space.
4. A threaded scheduler. One option is `bevy_ecs`'s multi-threaded executor; reported (2026-10-17), Bevy's task pools run on a single thread on wasm32, so that must be verified before it is chosen. The other is a rayon-style job pool used inside individual systems, splitting entities into fixed chunks by entity index and merging results in index order; reported (2026-10-17), `wasm-bindgen-rayon` provides such a pool for the browser. Contended actions stay in a serialized phase sorted by entity ID, as [D4] requires.
5. The simulation leaves the main thread, and the bridge changes with it. Reported (2026-10-17): browsers do not let the main thread block on `Atomics.wait`, so a threaded simulation would run in a worker. `web/src/bridge.ts` calls the wasm handle synchronously from the main thread: 258 call sites at commit `0fb6311ba`, counted with `grep -o "this\.handle\.[A-Za-z_0-9]*(" web/src/bridge.ts | wc -l`, including `enqueue_command`, `flush_commands`, `relationships_of`, `save_bytes` and `load_bytes`. With the simulation in a worker, each becomes an asynchronous message. A second wasm instance on the main thread that shares the memory does not remove that cost: most of these calls read or change state the worker is ticking, so each needs a handshake between ticks or a consistent snapshot, the same fence the render views need, and the main thread still may never wait on a lock. The renderer could still read [D11]'s typed-array views over shared memory, but only behind that fence or a double buffer so it never reads a half-finished tick.

Path A keeps [D11]'s zero-copy render views and can share one build with the browser if Path C also lands. It turns the synchronous bridge into an asynchronous, fenced one, keeps the 4 GB wasm32 address space with a ceiling fixed at link time, and, as reported above, adds a nightly compiler to the build.

### Path B: a native simulation process

Path B creates the reserved `terri-native` crate: a native program or library that runs `terri-sim` with ordinary operating-system threads, hosted by the shell's native side (Tauri's Rust core, or a helper process beside Electron). The web view keeps rendering and the DOM interface. Player commands travel to the simulation as postcard bytes, the wire format `terri-wasm` already decodes, and render state returns as messages.

Path B gives native threads without a nightly compiler or a rebuilt standard library, removes the wasm32 address-space limit from simulation memory, and lets Rust write saves as ordinary files. It replaces [D11]'s zero-copy views with a copy across a process boundary on every frame, so the frame-time budgets behind [R1] need new measurements. It also leaves two simulation builds, wasm for the web and native for the desktop, which must keep identical golden hashes ([L13]). That is harder here than in today's tests: the native build would link each operating system's math library for the `exp` and `hypot` calls listed under determinism requirement 5, and golden vectors would catch the resulting drift only by chance. Path B therefore requires simulation code to use one pure-Rust math library on every target, or fixed-point arithmetic, before a native simulation ships. The browser version stays single-threaded unless Path A and Path C also land.

### Path C: a web host that sends COOP and COEP

Path C moves the published web build to a host that sets response headers, as [T18] anticipated, so the browser version becomes cross-origin isolated and can load the same threaded wasm as Path A. Reported (2026-10-17): a service worker can add COOP and COEP to the responses it serves on a host that cannot set headers, at the cost of a reload on the first visit and the service worker's own failure cases; that would let GitHub Pages stay, but it is a workaround to test, not a decision. Reported (2026-10-17): cross-origin isolation also stops the page from loading cross-origin resources that do not opt in, and COOP cuts the link between the page and windows it opens. The Changelog link already opens its tab with `rel="noopener"`, so it does not rely on that link.

### The paths side by side

| Path | Threads in the desktop app | Threads in the browser | Memory past 4 GB | Bridge | Toolchain change |
| --- | --- | --- | --- | --- | --- |
| A | Yes | Only with Path C | No; the shared-memory ceiling is fixed at link time (reported). A wasm64 build is the reported alternative, on a tier 3 Rust target | Render views stay zero-copy behind a tick fence; the synchronous `bridge.ts` calls become asynchronous messages, or calls fenced between ticks | Nightly compiler and rebuilt standard library (reported) |
| B | Yes, native threads | No | Yes, for the desktop simulation | Every frame's render state is copied across a process boundary | None for the native build; simulation code moves to a pure-Rust math library or fixed point |
| C | Not applicable | Yes, with Path A's build | As Path A | As Path A | As Path A |

Path A with Path C gives one threaded build everywhere. Path B gives the desktop app the most room and leaves the browser as it is.

## Decisions still open

1. [DA-signing] Signing accounts and their costs, if unsigned installers draw too many warnings or support requests: a Windows code-signing certificate and the Apple Developer Program. No prices are recorded here.
2. [DA-identity] Product name and app identifier. [T1] in `docs/TIM-TODO.md` settled "Natural Causes" as the title and kept `terrilives` in storage keys and save fingerprints. An installer also needs a stable app identifier, usually in reverse domain form. Reported (2026-10-17): Windows and macOS key app data and updates on that identifier.
3. [DA-save-transfer] Save transfer between the web and desktop versions: an export and import file, its format version, and what happens when both copies have changed.
4. [DA-macos-minimum] The minimum macOS version, which the chosen shell's WebGPU support bounds. Reported (2026-10-17): macOS 26 for Tauri.
5. [DA-web-host] The web host: stay on GitHub Pages without COOP and COEP, try the reported service-worker workaround, or move to a host that sets headers ([T17], [T18]).
6. [DA-shell] Electron or Tauri, decided when installer work starts.
7. [DA-threads] Which multithreading path, and whether the browser version must be threaded too.
8. [DA-linux] Whether Linux is a target, given that WebGPU in WebKitGTK was not established by this research.
9. [DA-background] Whether simulated time passes while the desktop window is minimized.
10. [DA-version-bumps] When the version changes and what each part means: which changes raise the major, minor or patch number, who decides, and whether a bump happens with each merge to main, each published release or each installer. The mechanics are settled: edit the version in `web/package.json`, the `[workspace.package]` version in the root `Cargo.toml` and the README's Version line; refresh the lockfiles with `npm install --package-lock-only` in `web/` and any Cargo command that reads the workspace, such as `cargo metadata`; then run `web/tests/game-version.test.ts`.
