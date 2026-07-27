# Tim's TODO

Action items that need a human: purchases, accounts, legal terms, and decisions
that are not mine to make. IDs are stable; do not renumber.

**Owner tags:** `[TIM]` means it genuinely cannot be delegated (money, legal
agreements, accounts, taste). `[TIM or CLAUDE]` means say the word and I will
do it.

---

## Blocking - do before or during M0

### [T1] Decide whether "terrilives" is the shipping title `[TIM]`

Currently a working name from a pun on *terrible lives*. It shapes tone, domain
purchase [T18], and store presence [T17]. Cheap to change now, annoying later.

### [T2] Install the toolchain `[TIM or CLAUDE]`

Rust with the `wasm32-unknown-unknown` target, plus Node LTS and pnpm. I can run
this for you; it is listed so it is not forgotten.

### [T3] Download the CC0 asset packs `[TIM]`

Downloads need your explicit approval, so I cannot fetch these unprompted. I can
produce the exact URL list and a script; you approve the run. Sources are listed
in the asset table in TECH_STACK.md.

### [T4] Choose a code license and add a LICENSE file `[TIM]`

The repository has no LICENSE file. For a game given away free, the usual
choices are MIT or Apache-2.0 for permissive, or AGPL if you want derivatives to
stay open. **Absent a license file, the default is "all rights reserved,"** which
is probably not what you intend for a free public project.

Note this covers *code*. Asset licensing is separate and covered by [T13].

### [T5] Confirm the repository should stay public `[TIM]`

It is currently public. That is fine and probably desirable, but it interacts
with [T7]: **paid asset-store content must never be committed here.**

---

## Purchases and subscriptions

### [T6] Verify Synty's post-cancellation license terms BEFORE subscribing `[TIM]`

**Do this first.** The obvious move is to subscribe for two months at $30, pull
everything, and cancel. That may well be disallowed. Read the actual terms
before spending anything, because the answer determines whether [T7] is a
$60 decision or a $360/year decision.

### [T7] Decide on Synty: subscribe, buy individual packs, or skip `[TIM]`

Depends on [T6]. Their value proposition is cross-pack style consistency, which
is exactly the problem you cannot solve by hand. Weigh against [O2], which
solves a good chunk of it in shader for free.

### [T8] Check whether Synty has a residential interiors pack `[TIM or CLAUDE]`

I confirmed Town, City, and Shops packs but **could not confirm a dedicated
residential interiors pack**, which is what a life sim needs most. If that gap
is real, it materially weakens the case for [T7].

### [T9] Evaluate AI 3D tools on their free tiers `[TIM]`

Tripo and Meshy both have free tiers. Test before paying. The specific question
to answer: **does a generated prop, flat-shaded and palette-snapped at
isometric distance, sit convincingly beside a Quaternius mesh?** If yes, [O5] is
viable and your content ceiling rises a lot. If no, you are library-bound.

### [T10] Choose an AI image tool and decide on paid tier `[TIM]`

For [AI2] textures, [AI3] UI icons, and [AI4] diegetic art. Needs to support
LoRA training for [K3] and reproducible seeds for [K2].

---

## Decisions to lock before M1 content authoring

Tone and palette are both expensive to retrofit across a content library. Lock
them before volume authoring starts, not during.

### [T11] Lock the tone `[TIM]`

Direction is agreed (dark comedy, subtle-to-moderate, absurdist institutional
satire in an Onion register). What needs your sign-off is the craft guidance in
FEATURES.md: **satirize institutional form rather than named people or parties,
and prefer evergreen absurdity over current events.** Confirm or overrule.

### [T12] Approve the ~32-colour palette `[TIM]`

[K1] makes this the backbone of visual consistency across every asset from every
source. I can propose a palette; approving it is a taste call and it is yours.

### [T13] Approve the style bible `[TIM]`

[AI1]. 20-30 reference images fixing the look. Everything generated afterward is
conditioned on it, so it is worth a careful look rather than a glance.

---

## Before ghost sync ships (M4)

None of these block M0-M3. All of them block M4, and all take longer than
expected.

### [T14] Write a privacy policy `[TIM]`

**This is a real obligation, not a formality.** Ghost sync collects player IDs
and player-authored text, and likely IP addresses at the server. Depending on
where players are, that is personal data processing under GDPR, UK GDPR, or
CCPA. A free hobby game is lower risk, not zero risk.

### [T15] Publish terms of service and a code of conduct `[TIM]`

The moderation model in [D14] is report-driven and retroactive. **Bans without
published rules look arbitrary and are hard to defend.** State what is bannable
before you need to ban anyone.

### [T16] Set up object storage and decide the upload identity mechanism `[TIM]`

Cloudflare R2, S3, or Supabase. Storage-only, no game server ([D14]). Alongside
it, resolve [R9]: reading stays anonymous, but **uploading needs a durable
enough identity that a ban means something.** Decide what "lightweight" means
in practice.

---

## Distribution

### [T17] Choose a distribution platform `[TIM]`

itch.io, self-hosted, or both. itch.io gives you discovery and costs nothing;
self-hosting gives you control. Not mutually exclusive.

### [T18] Domain and hosting, if self-hosting `[TIM]`

Depends on [T17] and [T1]. Note the web build needs COOP/COEP headers for WASM
threads, so whatever you pick must let you set response headers.

---

## Conditional

### [T19] Commission a modular character set - only if CAS depth blocks progress `[TIM]`

[O6]. The free character foundation (Quaternius modular packs plus OverScore
Proxy) should carry you a long way. **This is the one line item worth paying for
if it does not**, because characters are where players look. Do not pre-emptively
spend here.

---

## Ongoing, once M4 is live

### [T20] Review moderation reports and operate the ban tool `[TIM]`

Report-driven moderation only works if someone reads the reports. This is a
recurring commitment that starts the day ghost sync ships and does not stop.
Worth being honest with yourself about before committing to [D13].
