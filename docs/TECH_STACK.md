# Tech Stack

Status: agreed in principle, nothing installed yet. Cross-references
ARCHITECTURE.md section IDs, which are stable.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Simulation core | **Rust** | Best perf-per-effort; compiles to both `wasm32` and native from one source; the compiler is an unusually dense correctness signal |
| ECS | **`bevy_ecs`** standalone | Mature archetypal ECS with an automatic parallel scheduler, without Bevy's weak UI story |
| Compile target (first) | **`wasm32-unknown-unknown`** | Web-first |
| Renderer | **WebGPU** via TypeScript | Compute shaders and far lower draw-call overhead than WebGL2 |
| UI | **DOM / HTML + CSS** | The decisive advantage; see below |
| Bridge | **`wasm-bindgen`**, zero-copy typed-array views | See [D11] |
| Content format | **TOML**, compiled to a binary pack | See [D9] |
| Save storage | **OPFS** | Real file handles from a worker, no meaningful quota ceiling |
| Backend | Object storage plus a thin API | Content sync only; see [D14] |

## Why this stack

**Rust for the sim core.** Two independent reasons converged. First,
performance and memory control, which you named as critical, and which the
"town" scale target genuinely requires. Second, and less obvious: Rust is the
best language for agentic development I know of, because `cargo check` catches
a large class of mistakes at compile time rather than surfacing them as a
heisenbug three hours into a simulation run. The borrow checker, exhaustive
`match`, and absence of null are all dense feedback an agent can iterate
against. The cost lands on the human reviewer, tracked as [R5].

**One source, two targets.** Because [A1] mandates a sim core with no engine
types, the same Rust compiles to WASM today and to a native binary later.
Web-first is therefore not a bet against desktop; the native build becomes a
shell project rather than a rewrite.

**DOM for UI, and this is the underrated argument.** A life sim is a UI
monster: needs panels, mood readouts, build and buy catalogs, character
creation, relationship trees, career panels, genealogy. In a game engine, all
of that gets built in an immature in-engine toolkit. On the web it is HTML and
CSS, the most mature UI stack in existence, trivially themeable and moddable by
anyone. Over a multi-year content project that advantage compounds.

**The memory picture.** wasm32 caps at a 4GB address space, with ~2GB the safe
number for broad device support. Simulation state is nowhere near that:

| What | Approximate cost at town scale |
|---|---|
| 5,000 sims x ~400 bytes of components | ~2 MB |
| 100,000 objects x ~100 bytes | ~10 MB |
| Relationships, sparse, capped ~150/sim | ~12 MB |
| **Art assets** | **Everything else** |

Two consequences. Simulation state is a rounding error, so the scale target is
comfortable. And **art is the real budget**, which is [R4].

**Store relationships sparsely, capped at roughly 150 per sim.** A dense N^2
matrix at 5k sims is 25M pairs and would sink the project. A sparse store with
a Dunbar-style cap is both cheaper and more behaviourally realistic.

## Rejected alternatives

**Pure TypeScript (bitECS plus a WebGPU renderer).** One language, fastest
iteration, simplest build, and bitECS is genuinely good since typed-array
struct-of-arrays in JS is faster than most people assume. Rejected because GC
pauses inside a fixed-timestep loop are a real problem, threads are painful,
and the simulation performance left on the table caps ambition at the
neighborhood tier. Reconsider only if the Rust review burden [R5] proves
intolerable in practice.

**Bevy, all-in.** Best-in-class ECS, native and web from one codebase, and it
would hand us [A2] and [A9] for free. Rejected on two counts: pre-1.0 churn
with breaking changes most releases, and a weak UI story, which is precisely
what this genre needs most. Note that we still use `bevy_ecs` as a standalone
crate, which captures the good part without the UI problem.

**Godot 4 or Unity with C#.** Both are excellent engines and C# is a strong
language with a good agentic-development profile. Rejected because Godot's
.NET web export has been experimental and unreliable, so choosing C# would
largely foreclose the browser path. **If web is ever dropped as a target,
Godot 4 plus C# immediately becomes the leading contender and this decision
should be revisited.**

**C++ (Unreal or custom).** Maximum ceiling, maximum time cost. Actively
steered away from here: slow compiles, weaker diagnostics than Rust, and
undefined behaviour meaning bugs manifest far from their cause. That is the
worst possible profile for both agentic iteration and human debugging.

## Art pipeline

The framing that matters: **art is more likely to sink this project than code
is.** The mitigation is not finding a cheaper way to produce an expensive
style. It is choosing a style that is **cheap by construction** - low-poly,
flat-shaded, palette-driven - and making that decision once, early.

### [G1] Generate by rendering, not by prompting

AI image generation fails on game assets not through quality but through
**consistency**. Forty independently generated chairs will not look like one
family, and isometric perspective consistency is worse still.

The pipeline that solves it: build or buy crude low-poly 3D, render from the
fixed isometric angle, then run a depth-conditioned AI style pass over the
render. Geometry and camera come from the 3D scene, so **perspective and
lighting are consistent for free** and the model only handles style.

### [G2] The locked camera keeps paying

Because the isometric angle never changes: props need no LODs, no back faces,
and no normals; lighting bakes into the sprite; draw cost is one instanced
quad. Critically, it also means **bought or AI-generated models only need to
look good from a single angle**, which drastically lowers the acceptable
quality bar for third-party assets.

### [G3] Modular kits, not finished rooms

Model wall segments, floor tiles, and counters; let the game compose kitchens.
Combinatorial content from a linear asset count. This is how Sims does it.

### [G4] Palette-mask shader

The highest-leverage art technology in the project. One chair mesh plus a
grayscale region mask equals fifty chairs. Players expect recolors of
everything in this genre and this delivers them at near-zero cost. **Build it
early**, because retrofitting masks across an existing asset library is
miserable.

### [G5] Characters get real attention; props do not

Low-poly base bodies, plus swappable mesh parts for hair and clothing, plus
palette swap for skin and fabric. Characters are where players look and where
AI 3D generation is weakest, so hand effort or a purchased base mesh goes
there. Props at isometric distance can be far rougher than intuition suggests.

### Asset sources

| Source | License | Notes |
|---|---|---|
| **Kenney.nl** | CC0 | Huge, consistent low-poly, purpose-built for this. Start here. |
| **Quaternius** | CC0 | Also excellent, also stylistically consistent |
| **Poly Pizza** | CC0 / CC-BY | Low-poly aggregator |
| **Synty POLYGON** | Paid, ~$20-80/pack | Very high consistency, shipped in many indie games. Strong value. |
| **Mixamo** | Free | Auto-rigging plus animation library. Significant for characters. |

### On AI-generated 3D

Text- and image-to-mesh tools exist and are improving, but as a production
pipeline they are **not yet reliable for characters or anything needing clean
topology and rigging**. Output typically has poor topology, unusable UVs, and
resists rigging. For background props viewed at isometric distance on a locked
camera, that is often acceptable. For player characters it is not. See [G5].

### Licensing cautions

- **CC0 is safe.** CC-BY requires attribution.
- Asset-store licenses commonly forbid redistributing **source** assets. Fine
  for a compiled game, a problem if assets are committed to a public repo.
- **Purely AI-generated work has unsettled copyright status.** The US Copyright
  Office has held it is not copyrightable. This matters only if ownership ever
  needs to be enforced, but it should be a conscious choice rather than a
  discovery.
