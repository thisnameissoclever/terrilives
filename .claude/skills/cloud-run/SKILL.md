---
name: cloud-run
description: Build, launch, and visually verify terrilives inside a headless cloud sandbox (Claude Code on the web or any remote container with no GPU and no display). Use when asked to run, launch, screenshot, or visually confirm the app and you are NOT on a desktop with a real browser. On a real machine with real Chrome, ignore this skill and use the normal dev workflow; sandbox captures are for identity checks only and every performance number taken here is meaningless.
---

# Running terrilives in a headless cloud sandbox

This skill is documentation only. The full write-up, with the evidence
behind every claim, is `docs/headless-sandbox.md`; read it before
deviating. The condensed procedure:

## 1. Build (a fresh clone does not run)

`web/src/wasm/` is gitignored build output and sandbox images lack
wasm-pack. Install the CI-pinned tools by hand - wasm-pack's own
binaryen download fails through the sandbox egress proxy, curl does not:

```sh
curl -sSfL -o /tmp/wp.tar.gz https://github.com/rustwasm/wasm-pack/releases/download/v0.15.0/wasm-pack-v0.15.0-x86_64-unknown-linux-musl.tar.gz
tar xzf /tmp/wp.tar.gz -C /tmp
install -m755 /tmp/wasm-pack-v0.15.0-x86_64-unknown-linux-musl/wasm-pack ~/.cargo/bin/wasm-pack
curl -sSfL -o /tmp/binaryen.tar.gz https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz
tar xzf /tmp/binaryen.tar.gz -C /tmp
install -m755 /tmp/binaryen-version_117/bin/wasm-opt ~/.cargo/bin/wasm-opt
```

Versions are pinned on purpose (see `ci.yml`); do not float them and do
not disable wasm-opt. Then, from the repo root:

```sh
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
cd web && npm ci && npm run typecheck && npm test
```

The wasm build must precede the web tests ([L8]).

## 2. Launch

Per `.claude/launch.json`: `npm --prefix web run dev` on `:5173`, or
`npm --prefix web run preview` on `:4173` for a production build.

## 3. Visual verification - the canvas will look black, and is not

Launch headless Chromium with:

```
--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
--use-angle=vulkan --disable-vulkan-surface --ignore-gpu-blocklist
```

Expect a `swiftshader` adapter on the app origin (it returns null on
`about:blank`; probe from the app page). Rendering works; presentation
does not - SwiftShader Vulkan here lacks `VK_KHR_surface`, so
screenshots and `drawImage` readback of the canvas are black, and any
buffer copied from the swapchain texture fails `mapAsync` with "A valid
external Instance reference no longer exists." None of that indicts the
app.

To capture the real frame: before page load, hook
`GPUCanvasContext.prototype.configure` to grab the device and format,
and replace `getCurrentTexture` to return a cached offscreen texture
(canvas-sized, `RENDER_ATTACHMENT | COPY_SRC`). After the app's own
`queue.submit`, `copyTextureToBuffer` from that texture and `mapAsync`.
`bytesPerRow` must be a multiple of 256, and the format is
`bgra8unorm`, so swap channels 0 and 2. Platform-global hooks only
([L20]).

Before believing any pixel, apply the `docs/testing-protocol.md`
discipline: confirm `document.visibilityState === 'visible'`, count rAF
callbacks, and count per-frame `draw`/`submit` at the platform
prototypes ([L14]). Compare recovered colours against the palette facts
in `docs/gpu-verification.md` [V14]; instance counts are content facts
and drift with `content/`.

## 4. What a sandbox run can and cannot establish

Trust: pixel identity, palette membership, draw/submit counts,
behavioural traces through `SimBridge`, the full test suites. Do not
trust: any frame time, percentile, or throughput number - SwiftShader
is a software rasterizer and `docs/gpu-verification.md`'s numbers are
all from real hardware. Take no performance measurements in a sandbox.
