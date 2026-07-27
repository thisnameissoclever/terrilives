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

### Hard constraint: zero authored assets

**The sole developer has no 2D, 3D, or animation skill and will not be
authoring visual assets.** This is a fixed input, not a preference. Every
decision in this section follows from it.

The operative reframe: **art volume is a programming problem.** The goal is to
never author a mesh and still ship thousands of visually distinct objects. That
is achieved by [O1] through [O3] below, all of which are code.

### [ST1] Style decision: flat-shaded low-poly, no textures

Untextured meshes with material and vertex colors. Optionally with a toon
outline post-process ([ST5]).

The decisive argument is not aesthetic: **adopt the style the free asset base
is already in.** Kenney and Quaternius are both flat-shaded low-poly. Matching
that library is free; fighting it is a tax paid on every asset forever.

Compounding benefits:

- **Texture-free largely dissolves [R4].** Untextured meshes are tiny, so the
  ~2GB art memory ceiling stops driving design.
- **[G4] palette masks become nearly free** - set material colors, author no
  mask textures.
- **The AI consistency problem disappears for props.** There is no texture to
  generate, so there is nothing to be inconsistent.
- **Most forgiving of AI-generated topology** ([O5]).

Honest cost: it reads casual/mobile and cannot express material richness. Wood,
fabric, and metal all resolve to colored planes. Mitigations that stay in
budget: colour temperature and saturation carry more of that load than expected,
and a little texture on **large surfaces only** (floors, walls, upholstery) goes
far. That is a targeted exception, not a style change.

### [ST5] Toon outline post-process

Roughly 20-30 lines of shader. Makes flat-shaded low-poly read far more crisply
at isometric distance and supplies visual identity at no art cost. Prototype in
M0.

### [O1] Design the catalog from the library, not the reverse

Inventory the available CC0 models first, tag each by the needs it satisfies,
and let that define the object catalog. If no CC0 hot tub exists, there is no
hot tub.

This inverts the usual failure mode, where a design document writes cheques the
art cannot cash. It is how a large share of solo projects actually ship.

### [O2] Unify style in the shader, not the model

The real problem with mixing free packs is not that any one looks bad, it is
that they do not match each other. Fixable without touching geometry:

- **Palette snap** ([K1]) - force every mesh's material colours to one palette
- **Uniform outline and lighting model** ([ST5])
- **Per-pack scale normalization** - much of the "these do not match" feeling is
  proportion mismatch, correctable with one scale factor per pack

Two packs by different artists, rendered through one shader and one palette,
read as siblings. This is the highest-value work available and it is entirely
programming.

### [O3] Procedural variation

One mesh becomes fifty objects:

- Palette recolors ([G4]) - one mesh, fifty catalog entries
- Non-uniform scaling - a table mesh becomes a desk, a coffee table, a nightstand
- Code kitbashing - combine library meshes and primitives at load time
- Modular composition for walls, floors, and counters ([G3])

**[O2] plus [O3] is roughly two weeks of development work, and it is the
difference between "stock asset game" and "your game."**

### [O4] Synty subscription

Synty offers their full library of 130+ art, animation, and UI packs on
subscription from **$30/month**, and the packs are explicitly designed to mix
and match across the range. The Shops Pack alone contains ~1,933 prefabs.

For a developer who cannot produce art, buying cross-pack consistency is a
legitimate shortcut rather than a luxury.

**Two unresolved caveats, both tracked in TIM-TODO.md:**

1. **Whether the license permits continued use after cancellation is
   unverified.** "Subscribe two months, pull everything, cancel" is the obvious
   move and may well be disallowed. Verify before subscribing.
2. Synty's strength is exteriors, shops, and city. **A dedicated residential
   interiors pack was not confirmed**, and residential interiors are exactly
   what a life sim needs most.

### [O5] AI 3D generation for gap-filling props

**This reverses an earlier, more dismissive position, and the reversal is
specific to this project's constraints.** General-purpose AI 3D is still weak.
But a prop that is ~40 pixels tall, viewed from one fixed angle, flat-shaded,
and palette-snapped hides bad topology almost completely. The locked isometric
camera neutralizes nearly every standard objection.

Tripo reportedly produces clean low-poly topology in seconds with automatic
game-engine topology optimization, which is the relevant profile. Those figures
come from vendor blogs and comparison-site content rather than independent
benchmarks, so treat them as directional and test before committing.

This is the answer for "I need a specific absurd satirical prop that exists in
no CC0 pack," which the tone direction in FEATURES.md guarantees will come up
constantly.

### [G1] Generate by rendering, not by prompting

Retained for the cases where a style pass over 2D output is wanted. AI image
generation fails on game assets through **consistency**, not quality: forty
independently generated chairs will not look like one family, and isometric
perspective consistency is worse still.

The fix is to render rather than prompt. Take low-poly 3D, render from the fixed
isometric angle, then run a depth-conditioned style pass over the render.
Geometry and camera come from the 3D scene, so perspective and lighting are
consistent for free and the model handles only style.

Lower priority under [ST1], since untextured meshes need no style pass at all.

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

### [G5] / [O6] Characters are the hard part

Props at isometric distance can be far rougher than intuition suggests.
Characters cannot, because that is where players actually look, and AI 3D
generation remains weakest exactly there because rigging demands clean topology.

The free foundation is better than expected: **Quaternius Universal Base
Characters** (rigged, retargetable, CC0) plus the **Ultimate Modular Men and
Women** packs, extended by **OverScore Proxy**, which adds a base model and
~315 clothing and accessory pieces.

**If customization depth becomes the thing holding the game back, a commissioned
modular character set is the one line item worth paying for.** Tracked in
TIM-TODO.md as a conditional, not a commitment.

### [O7] Animation

Also not authored. Minimum viable set is walk, sit, eat, sleep, and converse.

- **Mixamo** - free auto-rigging plus a large animation library
- **Quaternius Universal Animation Library** - CC0
- **Meshy** advertises a 500+ animation library

Between these, no animation should need authoring.

### Asset sources

Verified July 2026. Roughly 570 CC0 furniture and interior models are available
before authoring anything, against an M1 target of ~40 objects.

| Source | Contents | License |
|---|---|---|
| **Kenney Furniture Kit** | 140 models | CC0 |
| **Quaternius** (Ultimate House Interior, Ultimate Furniture, Furniture Pack) | ~240+ interior/furniture | CC0 |
| **KayKit Furniture Bits** | 50+, OBJ/FBX/GLTF | CC0 |
| **erenkatsukagi collection** | 86 furniture models | CC0 |
| **CubedBear Low-Poly Interior** | 30+, plus modular walls/floors | No attribution required |
| **Quin.GS Furniture** | 22 props, all under ~840 tris | CC0 |
| **Quaternius Universal Base Characters / Ultimate Modular Men + Women** | Rigged, modular characters | CC0 |
| **OverScore Proxy** | Base model + ~315 clothing/accessory models | Free, commercial use permitted |
| **The Base Mesh** | CC0 base meshes | CC0 |
| **Mixamo** | Auto-rigging + animation library | Free |
| **Poly Pizza** | Low-poly aggregator (Quaternius mirror, ~1,400 models) | CC0 / CC-BY |
| **Synty POLYGON** | 130+ packs | Paid, ~$30/mo subscription |

Quaternius is confirmed CC0 across all packs: commercial use, modification, and
redistribution permitted with no attribution required.

## Where AI is used, and where it is fenced off

Under [ST1], AI's role in 3D is near zero. That is a feature: it frees AI for
the work it is actually good at.

**Used for:**

- **[AI1] Style bible** - 20-30 reference images defining the look. Cheap, and
  worth far more than it costs across a multi-year solo project.
- **[AI2] Tileable textures** - wallpaper, flooring, fabric, ground. Abstract,
  tileable, and precisely where a life sim needs the most variety. Players want
  a hundred wallpapers; this is the one place textures pay for themselves.
- **[AI3] 2D UI** - moodlet icons, career icons, catalog thumbnails. High
  volume, low stakes.
- **[AI4] Diegetic 2D content** - paintings the sims make, posters, book covers,
  photographs, newspapers. A life sim needs hundreds of unique 2D images that no
  solo developer will hand-make, and it is content players actively collect.
  The strongest AI fit in the project.
- **[AI5] Text rather than images** - names, epitaphs, news headlines, flavour
  text. Given the register in FEATURES.md, an LLM is genuinely good at absurdist
  institutional headlines. Probably the single largest content multiplier for
  tone.

**Fenced off from:**

- **[AI-X1] Character meshes** - rigging requires clean topology ([O6])
- **[AI-X2] Anything that must tile or align with existing geometry**
- **[AI-X3] Hero props** the player sees constantly
- **[AI-X4] Sets viewed side by side** - forty chairs in a catalog grid is
  exactly where inconsistency screams

## Constraining AI output

Mechanisms, not intentions. Discipline that depends on memory will fail.

**[K1] A hard palette, mechanically enforced.** Define ~32 colours. Post-process
*every* asset, generated or not, to snap to the nearest entry. This is a
**mechanical fix for AI's consistency problem** and it unifies anything
regardless of provenance. Highest-leverage single technique in this document.

**[K2] Generation config is source code.** Prompt templates, model version,
sampler, seed policy, LoRA weights: committed and versioned. Regenerating an
asset in six months must still produce something that matches.

**[K3] LoRA trained on the approved set.** Once 20-30 assets are approved,
fine-tune on them. Everything generated afterward matches *this project's* style
rather than the model's average. The most effective consistency tool available.

**[K4] Validation in the content build.** [D9] already fails the build on
dangling references; extend it to art. Reject assets exceeding the poly budget,
using off-palette colours, exceeding texture dimensions, or missing metadata.
Make the build enforce the art bible.

**[K5] Generate by rendering, not prompting** ([G1]) for any style pass.

**[K6] Human approval gate.** No generated asset enters `content/` unlooked at.
Obvious, and the step that gets skipped at 2am.

## The honest cost of this approach

**A game built from public CC0 packs looks like other games built from public
CC0 packs.** Kenney and Quaternius assets are instantly recognisable to anyone
who plays indie games, and some players will notice.

[O2]'s palette-and-outline layer genuinely does a lot to make the same meshes
feel bespoke, but it does not erase the resemblance. This is a known and
accepted cost, not an oversight.

The mitigation that actually works: make the **palette, lighting, and UI**
distinctive, since those read as "style" more strongly than geometry does, and
all three are code.

## Licensing cautions

- **CC0 is safe**, including for commit to a public repository. CC-BY requires
  attribution.
- **Do not commit Synty or other paid-store assets to a public repository.**
  Those licenses generally forbid redistributing source assets. Fine inside a
  compiled build, a violation inside git. This repository is public.
- Maintain an **`ASSETS.md` provenance ledger** recording source and license per
  asset, even where CC0 requires no attribution. Costs nothing now, prevents a
  genuine mess if provenance is ever questioned.
- **Purely AI-generated work has unsettled copyright status.** The US Copyright
  Office has held it is not copyrightable. This matters only if ownership ever
  needs enforcing, but it should be a conscious choice rather than a discovery.
