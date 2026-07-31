# Running and verifying the app in a headless cloud sandbox

How to build, launch, and visually verify the game in a remote container
with no GPU, no display, and egress through a proxy - the environment a
cloud coding agent (Claude Code on the web and its relatives) actually
gets. Everything here was performed and verified on 2026-07-31 in such a
container: Playwright-managed Chromium (build 1194), rustc 1.94.1, Node
22, no X server.

The short version: the whole chain works, including the WebGPU renderer
under SwiftShader, but the canvas *presentation* path is broken in a way
that makes every ordinary screenshot of the canvas black. The frame is
still recoverable, byte for byte, by redirecting rendering to an
offscreen texture. The technique is below, and it reproduced the exact
palette recorded in `gpu-verification.md` [V14].

**What a sandbox measurement is worth.** Pixel identity checks, draw
counts, and behavioural traces are trustworthy here. Performance numbers
are not: SwiftShader is a software rasterizer, so nothing measured in a
sandbox belongs anywhere near the numbers in `gpu-verification.md`,
which are all from real hardware. Take no percentiles in a sandbox.

## Build

A fresh clone does not run: `web/src/wasm/` is gitignored build output,
and the sandbox images do not ship `wasm-pack`. Both gaps close in a few
minutes.

1. **Install wasm-pack v0.15.0** - the version CI pins against rustc
   1.94.1 (see the comment in `ci.yml`; an unpinned wasm-pack has broken
   this build before). The prebuilt musl binary works:

   ```sh
   curl -sSfL -o wp.tar.gz https://github.com/rustwasm/wasm-pack/releases/download/v0.15.0/wasm-pack-v0.15.0-x86_64-unknown-linux-musl.tar.gz
   tar xzf wp.tar.gz
   install -m755 wasm-pack-v0.15.0-x86_64-unknown-linux-musl/wasm-pack ~/.cargo/bin/wasm-pack
   ```

2. **Install wasm-opt from binaryen 117 yourself.** wasm-pack tries to
   download binaryen on first build and that download fails through the
   sandbox egress proxy, while the same URL fetched with curl succeeds.
   Do not disable wasm-opt; put the binary on PATH, where wasm-pack
   finds it and skips its own download:

   ```sh
   curl -sSfL -o binaryen.tar.gz https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz
   tar xzf binaryen.tar.gz
   install -m755 binaryen-version_117/bin/wasm-opt ~/.cargo/bin/wasm-opt
   ```

3. **Build and check, exactly as CI does:**

   ```sh
   wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
   cd web && npm ci && npm run typecheck && npm test
   ```

   The wasm build must come first: the web tests import the emitted
   package and have no idea whether the Rust moved ([L8]). All of this
   passed unmodified in the sandbox - the pinned toolchain in
   `rust-toolchain.toml` installs itself via rustup on first use, and
   the `wasm32-unknown-unknown` target is part of that pin.

## Launch

`.claude/launch.json` already describes both servers. From the repo
root: `npm --prefix web run dev` serves on `:5173`; `npm --prefix web
run preview` serves a production build on `:4173`. Nothing
sandbox-specific.

## Headless WebGPU: what works, what lies, and why

### The flags

One flag set produced a working adapter in the sandbox Chromium:

```
--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
--use-angle=vulkan --disable-vulkan-surface --ignore-gpu-blocklist
```

`GPUAdapter.info` reports `vendor: 'google', architecture:
'swiftshader'`. Every reduced variant tried - dropping the ANGLE flag,
dropping the Vulkan feature, `--use-webgpu-adapter=swiftshader` alone -
returned no adapter at all. `--in-process-gpu` crashed the browser
outright. One unexplained observation, recorded so nobody burns time on
it: `requestAdapter()` succeeded on the app's `localhost:5173` origin
and returned null on `about:blank` under the same flags. Probe from the
app page.

### The presentation hole

With the flags above the page runs: `document.visibilityState` is
`visible`, `requestAnimationFrame` fires at ~60/s, and one
`GPURenderPassEncoder.draw` plus one `GPUQueue.submit` land per frame,
so the [L14] checks all pass. The canvas is black anyway, in Playwright
screenshots and in `drawImage` readback alike, and the readback black is
`0,0,0` - not the `23,23,28` clear colour, which is the tell that the
compositor received nothing rather than an empty scene.

The cause is in the GPU process stderr: SwiftShader's Vulkan in this
container exposes neither `VK_KHR_surface` nor `VK_KHR_xcb_surface`, so
ANGLE's Vulkan display fails to initialize and there is no path from
Dawn's rendered texture to the compositor. Rendering executes;
presentation does not. The swapchain texture is poisoned in a second way
that matters for verification: a buffer filled by `copyTextureToBuffer`
*from the canvas texture* fails `mapAsync` with "A valid external
Instance reference no longer exists." - the same message the page logs
once as a warning at startup. That error on an app page in a sandbox
means the present path, not the app.

Dawn itself is fine. The control that establishes it: render to an
ordinary offscreen texture (`RENDER_ATTACHMENT | COPY_SRC`), clear to
red, `copyTextureToBuffer`, `mapAsync` - returns exactly
`255,0,0,255`. Offscreen work is trustworthy; anything touching the
swapchain is not.

### Capturing the real frame anyway

Since offscreen textures work and swapchain textures do not, hand the
app an offscreen texture. Before the page loads, hook
`GPUCanvasContext.prototype.configure` to capture the device and format,
and replace `getCurrentTexture` with a function returning a cached
offscreen texture of the canvas's size with `RENDER_ATTACHMENT |
COPY_SRC` usage. The app renders its genuine frame into it; after the
app's own `submit`, copy the texture to a buffer and map it. Two
mechanical details: `bytesPerRow` must be a multiple of 256 (1280 wide
x 4 bytes is already 5120, fine), and the preferred format here is
`bgra8unorm`, so swap channels 0 and 2 when building an image from the
bytes.

This is a platform-global hook, which is the [L20] rule: it cannot be
defeated by module identity, and the app's code runs unmodified.

### What the capture showed, 2026-07-31

The frame recovered this way matched [V14]'s palette exactly: clear
colour `23,23,28`, floor fill `186,155,118`, lit wall face
`255,251,241`, shaded wall face `137,134,132`, with 7,675 distinct
colours against [V14]'s 7,980 - antialiased art, different sim state,
same scene. Draw args were `(6, 182)` per frame; [V14] recorded
`(6, 499)` before the content changed, so the instance count is a
content fact, not a constant. The DOM layer (need bars, speed controls)
screenshots normally, since only the WebGPU canvas is affected.

## The checklist form

For an agent that just needs the steps: install wasm-pack 0.15.0 and
wasm-opt 117 by hand as above, build the wasm package, `npm ci`, run
typecheck and tests, launch via `.claude/launch.json`, and verify
visually only through the offscreen-texture hook with the flag set
above, checking `visibilityState`, a rAF count, and per-frame draw and
submit counts before believing any pixel. Trust identity, distrust
performance.
