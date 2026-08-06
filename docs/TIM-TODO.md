# Tim's TODO

**Inclusion rule:** an item earns a place here only if I genuinely cannot do it,
or if it would be unwise for me to do unilaterally. Anything I can do myself, I
do - I do not park work here to avoid asking.

Three categories:

- **[YOURS]** - only you can do it. Money, accounts, legal adoption, taste.
- **[APPROVE]** - I do the work; I need your explicit go-ahead first, because it
  is destructive, outward-facing, or spends something.
- **[MINE]** - listed only so you can see it is tracked. Do not action these.

IDs are stable and are never renumbered or reused, including for items that
move between categories.

---

## Decisions only you can make

### [T1] Decide whether "terrilives" is the shipping title `[YOURS]`

A working name from a pun on *terrible lives*. Shapes tone, the domain purchase
[T18], and store presence [T17]. Cheap now, annoying later.

### [T22] Author the game's VOICE with me `[YOURS]` - the last alpha criterion

**This is the only thing standing between the project and a finished
playable alpha.** The other ten of the eleven criteria in
`docs/alpha-goals.md` are shipped and verified by running the game;
criterion 11 - "the game's voice, dark comedy, present in play" - says
*authored WITH the owner*, and [L58] records why I must not do it alone:
comedy written to spec by an agent reads as an agent writing comedy to
spec. Your voice is the product.

**Everything that can be prepared is prepared.** M2g shipped the string
inventory at `docs/player-visible-strings.md` and drew the boundary
between FUNCTIONAL text (button labels, error messages, the need meters
- these stay plain and stay mine) and VOICE text (object names, flavour,
the things a player reads for pleasure). No comedy has been smuggled
into the functional layer while waiting.

**What the session actually needs from you** is an hour or so of
reacting, not writing: I read you what a thing currently says, you say
it back in your own voice or tell me it is fine, and I write down the
rule you were following without knowing it. Twenty or thirty strings is
enough to extract a house style; the rest I can draft against that style
for you to veto.

Cheap to start and easy to stop - and until it happens, the alpha is
complete but voiceless.

### [T23] Verdict: should the sim with a job out-earn the one without? `[YOURS]`

A taste call, surfaced rather than decided, because it is exactly the
kind of "does this feel right" question that is yours.

The alpha acceptance pass found the household's only worker living
permanently at zero on six of seven needs - a shift drained her at full
rate somewhere she could reach nothing - and fixed it ([A-19], [X2]).
A side effect: her life score moved 297.7 to 384.7 and now **tops** the
settled sim's 364.0, reversing the order the career milestone recorded
in [A-14]. She is not paid more; she loses less to neglect and has the
energy for her hobbies.

Two defensible readings, and I do not think the numbers can settle it:

- **Working should cost you.** A job eats a third of the day, and the
  employed sim placing first makes the career look like a reward rather
  than a trade.
- **Working already costs you** - the hours are gone either way - and a
  sim who copes with a hard schedule earning a good life is the more
  interesting story.

One knob, one line: `at_work_decay_scale` in `content/tuning.toml`.
Lower it toward 0 and the job hurts more; `1.0` restores exactly the
starvation the pass found, so that end is not available. Tell me which
way it should read and I will retune and re-measure.

### [T4] Choose a code license `[YOURS]`

**The decision is yours; I will write the file once you pick.** Usual options
are MIT or Apache-2.0 for permissive, or AGPL if you want derivatives to stay
open. **With no LICENSE file the default is "all rights reserved,"** which is
almost certainly not what you want for a free public project.

Covers code only. Asset licensing is separate and handled under [T5].

### [T7] Decide on Synty: subscribe, buy individual packs, or skip `[YOURS]`

Spends money, so it is yours. I am doing the groundwork in [T6] and [T8] so you
are deciding with facts rather than guesses.

### [T9] Evaluate AI 3D tools `[YOURS]`

Tripo and Meshy have free tiers, but both need account signup, which I cannot
do. Once you have access I can help judge the output.

The question worth answering: **does a generated prop, flat-shaded and
palette-snapped at isometric distance, sit convincingly beside a Quaternius
mesh?** If yes, [O5] is viable and the content ceiling rises a lot.

### [T10] Choose an AI image tool `[YOURS]`

Account and possibly money. Needs LoRA training for [K3] and reproducible seeds
for [K2].

### [T11] Lock the tone `[YOURS]`

Direction is agreed. What needs your sign-off is the craft guidance in
FEATURES.md: **satirize institutional form rather than named people or parties,
and prefer evergreen absurdity over current events.** Confirm or overrule.

### [T-design-language] Pick the design language - DECIDED AND SHIPPING

**Muted Line, and it is in the running game.** Every sprite is drawn by
`assets/sprites/gen/`, the world tints with the clock, the lamp and the
television stay lit after dark, and Tim, Bill and Casey are three
different people rather than three copies of one. The plan and its current
state are in `docs/specs/2026-08-03-muted-line-implementation.md`; the
prototype the choice was made against is `tools/art-prototype/`, wired into
nothing.

**One thing needs you, and it is small.** The circadian rhythm is built and
switched off: `content/tuning.toml` carries the `[circadian]` block
commented out because the CURVE is not tuned, and tuning it wants a watched
run rather than another guess from me. Uncommenting it turns on sims
sleeping at night; the numbers beside it are a first draft, not a
recommendation.

The first paper's five options were rejected whole, and correctly: each one
restyled the existing sprites, and a grade over borrowed art is still
borrowed art. What replaced them is original art drawn by a generator, so
the style is a palette, a shape language and a set of character-build
numbers rather than a filter. Nothing in the game's art comes from a pack
any more.

Two of your notes on round one shaped round two and are now settled: the
outline is 1 px and never black, and no wall is a hue, so the furniture
carries the colour. The day/night strip that came out of the lighting rig
also settled a question nobody had asked yet, which is that night is a
lighting setting rather than a second art style.

### [T12] Approve the colour palette `[YOURS]` - MOSTLY SETTLED

Settled in practice by [T-design-language]: Muted Line's palette *is* the
approved palette, and it lives in the generator's `style.py` rather than in
a document. [K1]'s "define ~32 colours and snap everything to them" is now
enforced by construction, because the generator has no other colours to
draw with.

What is left for you is smaller and can wait for the port: whether the
accent set wants a fifth entry, and whether the wall neutral is warm enough.
Both are one-line changes with an immediate re-render.

### [T13] Approve the style bible `[YOURS]` - NO LONGER NEEDED

A style bible exists to keep *generated* assets consistent with each other.
A generator is consistent by construction, so `style.py` replaces it and is
executable rather than a folder of reference images.

Closing this does not need a decision from you unless you disagree.

### [T10] revisited by [T-design-language]

Choosing a procedural direction takes the AI image tool off the critical
path entirely: no model, no LoRA, no seed policy, no regeneration risk, and
no question about whether sprite art is copyrightable. [T10] survives only
as an option for the diegetic 2D layer - paintings, posters, book covers -
and even there the plan recommends trying procedural first. See Part 4 of
the implementation spec.

### [T16] Set up object storage and pick the upload identity mechanism `[YOURS]`

Account creation, so it is yours. **I will design the identity scheme and write
the client**; you create the account and hold the credentials.

Resolves [R9]: reading stays anonymous, but uploading needs an identity durable
enough that a ban means something.

### [T17] Choose a distribution platform `[YOURS]`

itch.io, self-hosted, or both. Not mutually exclusive.

### [T18] Domain and hosting, if self-hosting `[YOURS]`

Depends on [T17] and [T1]. The web build needs COOP/COEP headers for WASM
threads, so whatever you pick must let you set response headers.

### [T19] Commission a modular character set - only if CAS depth blocks progress `[YOURS]`

[O6]. The free foundation should carry you a long way. **This is the one line
item worth paying for if it does not**, because characters are where players
look. Do not pre-emptively spend here.

### [T21] Repair the MSVC toolchain in Visual Studio Community 2026 - DONE 2026-07-27

**Resolved.** The "Desktop development with C++" workload installed the desktop
x64 CRT across all three toolsets, and `cargo test --workspace` now passes with
no wrapper. Verified independently. Kept here for the record; see [L1] in
`docs/lessons-learned.md` for the diagnosis and the one remaining watch item.

**Diagnosis:** VS Community 2026 (18.8) at
`C:\Program Files\Microsoft Visual Studio\18\Community` has MSVC toolset
14.51.36231 with `lib\onecore` but **no `lib\x64`**, so `msvcrt.lib` cannot be
found and nothing links. `rustc` auto-selects the newest Visual Studio, so it
picks this broken one over the working 2022 BuildTools install.

**Fix:** Visual Studio Installer, Modify on VS Community 2026, Workloads tab,
tick **"Desktop development with C++"**, then Modify.

**Component naming note:** there is no "MSVC v145" in VS 2026. Microsoft
changed the scheme; the current toolset is **"MSVC Build Tools for x64/x86
(Latest)"**, and the `v143` / `v142` / `v141` entries are legacy toolsets for
older projects. Also ensure a **Windows 11 SDK** is ticked. Both are selected
automatically by the Desktop C++ workload.

**Untick "MSVC Build Tools for x64/x86 (Preview)".** `rustc` auto-selects the
newest toolset it finds regardless of whether that toolset is complete, which
is what caused this failure originally. Keeping only the release toolset makes
that selection deterministic and stops the problem recurring after VS updates.

**Verify** in a new terminal:
`Get-ChildItem "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\*\lib\x64\msvcrt.lib"`
should print a path, and `cargo test -p terri-core` should pass with no wrapper.

Requires admin and a 2-4GB download, which is why this is not mine to run.

### [T20] Review moderation reports and operate the ban tool `[YOURS]`

Inherently human, and recurring. Report-driven moderation only works if someone
reads the reports, every week, indefinitely. Worth being honest with yourself
about that before committing to [D13].

---

## Needs your go-ahead, then I do it

### [T3] Approve any additional CC0 asset-pack downloads `[APPROVE]`

The old Kenney Furniture Kit is downloaded and recorded in `ASSETS.md`, but no
pack art remains in the shipped alpha. Muted Line replaced it with generated
original sprites. If a future 3D or full-art pipeline needs CC0 packs, I will
assemble the exact URL list and fetch script and ask before downloading.

### [T5] Confirm the repository should stay public `[APPROVE]`

It currently is, which is fine and probably desirable. One consequence to
acknowledge: **paid asset-store content must never be committed here.** Say the
word if you want it private instead.

### [T14] Privacy policy `[APPROVE]`

**I will draft it; adopting and publishing it is yours**, because it is a legal
representation made in your name.

Not optional. Ghost sync collects player IDs and player-authored text, and
likely IP addresses server-side. That is personal data processing under GDPR,
UK GDPR, or CCPA depending on where players are. A free hobby project is lower
risk, not zero risk. Blocks M4 launch, not M4 development.

### [T15] Terms of service and code of conduct `[APPROVE]`

Same split: I draft, you adopt. **Bans without published rules look arbitrary
and are hard to defend**, and [D14] moderation is report-driven and retroactive.
State what is bannable before you need to ban anyone.

---

## Tracked, but mine - no action needed from you

### [T2] Install the toolchain `[MINE]` - DONE

Rust with the `wasm32-unknown-unknown` target, plus Node and wasm-pack. Handled
as part of M0 Task 1.

### [T6] Verify Synty's post-cancellation license terms `[MINE]` - DONE 2026-08-01

Verified against Synty's current
[Standard Subscription Licence](https://syntystore.com/pages/standard-subscription-licence),
dated 9 July 2026. SyntyPass asset-use rights are tied to an active
subscription. After cancellation or expiry, an existing product may receive
minor bug fixes only if it is not substantially developed, modified, or
improved; substantial development requires an active subscription. New
intellectual property and new marketing material cannot use the subscription
assets. Existing published marketing may remain live.

The current [SyntyPass](https://syntystore.com/products/syntypass) monthly
plan is $40/month with a three-month prepaid minimum, or $120 minimum, versus
$360/year. Subscribe-download-cancel is not a perpetual development licence.
Either keep SyntyPass active throughout development or buy required packs
under the perpetual
[One-Time Purchase Licence](https://syntystore.com/pages/one-time-purchase-licence).
Before relying on post-cancellation rights, obtain written confirmation from
Synty about continued sales, patches, ports, and what counts as substantial
modification; the published terms do not define that boundary precisely.

### [T8] Check whether Synty has a residential interiors pack `[MINE]` - DONE 2026-08-01

Verified against Synty's official store. The gap is not real.

[SIMPLE House Interiors - Cartoon Assets](https://syntystore.com/products/simple-house-interiors-cartoon-assets)
is a dedicated modular residential-interior pack with living-room, bedroom,
bathroom, furniture, household-prop, and surface assets. It includes Unreal,
Unity, and FBX source files, but belongs to Synty's SIMPLE line rather than
POLYGON and has no listed Godot or web-ready glTF package.

More importantly, [POLYGON - Town Pack](https://syntystore.com/products/polygon-town-pack)
already includes a modular house kit, preset houses, residential interior
pieces, bedroom decorations, sofas, beds, bathtubs, washing machines, and
other household props. It is the more coherent starting point for Terrilives,
though its furniture breadth may not support a deep build-and-buy system
without supplementary or custom assets.

This removes the missing-residential-pack objection from [T7]. Before any
purchase, test representative Town and SIMPLE House Interiors FBX assets
together in the real renderer for style, scale, conversion quality, and the
interaction and footprint work the raw assets do not provide.
