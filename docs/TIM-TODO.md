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

### [T12] Approve the colour palette `[YOURS]`

**I will propose one; approving it is a taste call and it is yours.** [K1] makes
this the backbone of visual consistency across every asset from every source.

### [T13] Approve the style bible `[YOURS]`

[AI1]. Depends on [T10]. Everything generated afterward is conditioned on it, so
it deserves a careful look.

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

### [T3] Download the CC0 asset packs `[APPROVE]`

Not needed until M1. I will assemble the URL list and a fetch script and ask
before running it, since downloads need your explicit approval.

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

### [T2] Install the toolchain `[MINE]`

Rust with the `wasm32-unknown-unknown` target, plus Node and wasm-pack. Handled
as part of M0 Task 1.

### [T6] Verify Synty's post-cancellation license terms `[MINE]`

I can read the terms myself. Doing this before [T7] so you are not deciding
blind. The obvious play is subscribe-two-months-pull-everything-cancel, and it
may be disallowed; that answer is the difference between a $60 decision and a
$360/year one.

Deferred until M1, when art actually matters.

### [T8] Check whether Synty has a residential interiors pack `[MINE]`

I confirmed Town, City, and Shops but **could not confirm a residential
interiors pack**, which is what a life sim needs most. If that gap is real it
materially weakens the case for [T7]. Deferred until M1 alongside [T6].
