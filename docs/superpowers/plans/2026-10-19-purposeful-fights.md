# Purposeful Fights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Tasks end with focused verification and independent review.

**Goal:** Resolve issue 314 with attributable mood-sensitive fights, useful chore responses and positive cleanup relationships.

**Architecture:** Keep the existing social admission owner and voice timing. Record actual annoyance in indexed saved memory. Add a V20 envelope around frozen V19, and keep ordinary board accounting separate from physical appreciation and post-fight repair.

**Tech Stack:** Existing Rust simulation and content compiler, WebAssembly bridge, TypeScript browser application and static GitHub Pages publication. No dependency changes.

**Spec:** `docs/superpowers/specs/2026-10-19-purposeful-fights-design.md`.

## Global constraints

1. Follow the spec's numeric choices and the exact neutral 0.80 response baseline. Grievances last six game hours for autonomy and seven game days for player relevance; repair lasts four game hours.
2. Preserve all published nested records through V19. Older readers retain their original contracts. Use tagged actor references for named and bare player fighters.
3. Critical needs and real player orders outrank system fights and accepted chore responses. Never manufacture a player order for a response.
4. Use real event owners, never the reset diagnostic stream, as behavioral evidence. Do not invent historical privacy, nuisance or interruption incidents on load.
5. Use central opinion scaling once. Keep family positive 1.5, negative 0.5, the one-third base-drain reduction and prior grace semantics from PR 316.
6. No em or en dashes. Apply Tim's writing style, Unslop and project writing rules to comments, copy and documentation. Functional labels stay literal; no authored-name rewrite.
7. Parent owns compilation, broad tests, commit, push, merge and deployment. Workers coordinate before any heavy command and do not commit independently.

## Review focus

1. A resolved or reassigned duty must not create or retain an autonomous argument against its old owner.
2. A save during private use, a fight or partial cleanup must preserve future outcomes without replaying annoyance or rerolling response acceptance.
3. Cleaning by a helper, another chore or fresh dirt must not pay an old recipient's repair bonus.
4. Removing an actor, changing architecture, pausing, build cancellation and bare player actors must retain valid ownership and bounded memory.
5. Large admitted saves must not introduce repeated global scans, unbounded history, duplicate witness awards or impossible writer/reader bounds.

## Shared wire and runtime interfaces

The persistence owner creates these names in `terri-core/src/save_v20.rs` before runtime integration. Workers may settle small representational details together, but update this contract when doing so.

1. `ChoreObligation { key: ChoreKey, owner: u32, actionable_since: u64 }`, ordered and copyable.
2. `GrievanceKind`: PrivacyEntry, PrivacyStart, Nuisance, NeedInterruption, Chore.
3. `NuisanceKind`: Television, Music, Exercise, Other.
4. `GrievanceSubject`: None, Chore(ChoreObligation), Nuisance { object: u32, kind: NuisanceKind }.
5. `SavedGrievance`: `id`, `affected`, `responsible`, `kind`, `subject`, `occurred_at`, `last_seen`, `active_until`, `forget_at`, `severity` and `last_fought`.
6. `SavedFightContext`: `initiator` and `recipient` as `SavedOrderActor`, `grievance: Option<u64>`, `autonomous`, `legacy`, `order_id: Option<u64>`, `started_at`, `topic_code: u8` and `topic_tag`. Require separate exact contexts for every running fight and autonomous pending fight, with separate runtime indexes and a combined saved sequence sorted by actor and order ID. Queued player fights select their context at contact. None grievance is random player fallback or an explicitly imported legacy fight only. Historical source loaders create legacy contexts for old running and exact system-owned pending fights; current V20 loading rejects missing contexts. Legacy contexts use only the original topic codes 24 through 26 and grant no invented chore repair.
7. `SavedChoreRepair`: permanent `recipient` and `initiator`, `obligation`, `fought_at`, `deadline`, `accepted`, `attempted`, `working`, `contributed_units: u32` and sorted unique `witnesses`.
8. `SavedConflictState`: `next_id`, `grievances`, `fights`, `repairs` and `dish_contributions: Vec<SavedDishContribution { obligation, person, units }>`; default empty with next ID one. `SaveSnapshotV20 { legacy: SaveSnapshotV19, conflicts: SavedConflictState }`.

The runtime owner creates `social_conflicts::State`, with indexed grievances, separate running and pending fight collections, a crate-visible dish contribution map keyed by `(ChoreObligation, contributor)` and a crate-visible repair map keyed by `(recipient, fought_at, initiator)`. Index pair/subject/witness lookups. Provide `remember`, `witnesses_for`, `snapshot`, `restore`, `hash`, `tick`, actor-removal handling and context lifecycle helpers. The chore owner can mutate repair rows through the agreed state API. The persistence owner calls these functions instead of duplicating their logic. Chore responses run after board reconciliation and neglect refresh, before ordinary daily willingness. Paused and final tick reconciliation clears invalid ownership without new work or random draws.

The chore owner provides `chore_repair::obligation`, `still_unfinished`, `record_annoyance`, `fight_completed`, `tick_in`, completion/cancellation hooks and saved-repair validation. Duty identity comes from the matching current assignment and `SavedNeglect.duties`. Exact signatures may use existing entity/SimId conventions, but all owners must agree before callers are written.

New root tuning names and live initial values: `fight_grievance_ticks=360`, `fight_history_ticks=10080`, `fight_repeat_grievance_ticks=1440`, `fight_mood_bad_multiplier=2`, `fight_mood_good_multiplier=0.25`, `fight_opinion_strength=0.5`, `fight_severity_reference=0.25`, `chore_fight_response_base=0.80`, `chore_fight_response_ticks=240`, `chore_fight_response_cleanliness=0.20`, `chore_fight_response_responsibility=0.10`, `chore_fight_response_commitment=0.05`, `chore_fight_response_preference=0.05`, `chore_fight_response_affinity=0.05`, `chore_fight_response_mood=0.05`, `chore_repair_base=0.08`, `chore_repair_cleanliness=0.04`. Change the existing live `fight_chance_per_tick` to `0.001`. The persistence owner defines validated ranges and historical decoder defaults consistently with published content compatibility and records any needed ruling.

### Task 1: Establish behavioral red tests

**Owners:** fight worker and parent chore worker.

**Files:** `crates/terri-sim/src/fights.rs` and its new issue314 test module; chore/domestic test modules.

- [ ] Add existing-API tests prefixed `issue314_` proving that real mood inputs change autonomous likelihood, actual privacy can cause a fight, current assignment is required and real cleanup with the board off earns appreciation.
- [ ] Keep product behavior unchanged. Run one shared `cargo test --workspace issue314_ -- --test-threads=4` and retain actual assertion failures.
- [ ] After parent confirms the red run, proceed with the independent implementation tasks. New API and persistence tests follow as their types exist.

### Task 2: Add the saved envelope and tuning

**Owner:** persistence worker.

**Files:** create `terri-core/src/save_v20.rs`, `terri-sim/src/save/v20.rs`; own Core save exports/version dispatch, `terri-sim/src/lib.rs`, save restore topic-mode transport, current snapshot helpers, build/ordinary/land/mortality transport, Wasm writer/reader, browser save header/worker, frozen V19 worker and directly related tests/examples. Own content tuning definitions, compiled encoding/decoding and `content/tuning.toml` for this task. Coordinate ownership of room reconciliation hooks with the parent.

- [ ] Define the shared wire records and append tuning using the existing live-versus-historical content conventions. Do not modify authenticated fixture bytes or blindly replace golden hashes.
- [ ] Add V20 capture, strict atomic restore and hash integration through the runtime owner's API. Carry the outer fight-topic contract through historical inner reconstruction without widening historical entry points.
- [ ] Preserve complete current state in transactions and test views. Keep build Cancel and failed loads atomic.
- [ ] Freeze the actual current V19 storage worker, preserve backups and reject forward writes from the old worker. Add current-header and mid-fight/mid-response reload tests.
- [ ] Verify dangling/duplicate actors, future timestamps, bad topics, unsorted or excessive rows and inconsistent working repairs are rejected. Verify pause, death and geometry changes through real entry points.
- [ ] Report focused results and request an independent task review. Parent owns broad compilation and delivery.

### Task 3: Implement attributable fights and memory

**Owner:** fight worker.

**Files:** `terri-sim/src/fights.rs`, new `social_conflicts.rs` and focused child modules/tests, interpersonal and nuisance producer hooks, `social_episode::begin_topics`, `systems/social.rs` fight completion hooks, relevant topic rendering files/tests. Do not edit persistence owner's files without coordination.

- [ ] Record actual scaled annoyance at the producer. Preserve shared-interest exemptions and diagnostic independence. Use the shared wire records and bounded indexes.
- [ ] Select deterministic attributable candidates, then draw once per initiator. Apply bounded mood/severity/opinion probability and both participants' cooldowns.
- [ ] Keep exact player/system provenance. Revalidate pending and admitted system fights; withdraw when no relevant cause remains, including resolved current chores. Player orders retain their existing protection.
- [ ] Capture actual-start context, choose existing-topic random fallback only for a player with no relevant current/history grievance, and add truthful privacy/nuisance/interruption topic display.
- [ ] On completed fights, retain existing fight losses and moodlets, mark the selected grievance and call `chore_repair::fight_completed` for current chore contexts. Interrupted fights grant no outcomes or repair decision.
- [ ] Test directionality, cause expiry, no reason/no draw, random fallback provenance, one draw with many recipients, cooldowns, cancellation and saved context. Request independent task review.

### Task 4: Implement appreciation and chore follow-through

**Owner:** parent.

**Files:** new `terri-sim/src/chore_repair.rs` and tests; `chores/board.rs`, `chores/consequences.rs`, `chores/mod.rs`, `chores/work.rs`, `domestic.rs` and directly related tests. Own all project documentation and in-game Help updates.

- [ ] Move ordinary appreciation from board settlement to real completed physical cleaning. Preserve commitment, episode and dish contribution-leader accounting. Exclude canceled and zero-unit work; prevent duplicate washing/board awards.
- [ ] Capture scoped prior annoyance before sources and visit data disappear. Preserve the actual responsible person and assigned duty owner separately when they differ.
- [ ] Implement the centered 0.80 acceptance formula and one saved chore-stream draw per completed relevant fight. Admit accepted responses as ordinary nondirected work after higher-priority obligations permit it.
- [ ] Preserve exact duty continuity through gradual cleaning. Match actual recipient completion, deadlines and current obligation; pay each observer once across windows. Award reciprocal participant repair and central family scaling once.
- [ ] Test board off, repeat same-day work, partial dishes, helper completion, wrong duty, fresh dirt, canceled partial work, route failure, competing player orders, critical needs, deadline/midnight edges, later witnesses and save seams. Request independent task review.
- [ ] Update the existing fight/privacy/relationship/cleanliness specs, glossary/current-format references, in-game Help and same-day changelog. Keep issue 313's public-site structure proposal separate.

### Task 5: Verify, review and deliver

**Owner:** parent, with fresh independent reviewers.

- [ ] Run appropriate focused checks and fix every valid finding before broader checks. Use fresh compiled artifacts and preserve the workspace feature graph.
- [ ] Prove load-bearing guards with targeted faults and selected automated mutation checks. Restore exact source bytes and rerun the focused baseline.
- [ ] Run relevant native, browser, formatting, lint, type, Wasm, production, changelog and documentation gates. Measure a controlled fight cohort and ordinary household survival in release.
- [ ] Watch real player and autonomous fights, topic display, accepted cleanup and relationship repair in the game. Inspect selected captures and obtain fresh independent visual review; close task-owned pages and servers.
- [ ] Obtain final fresh adversarial whole-branch review. Address valid findings. Refresh remote main and reconcile same-day public notes before push and merge.
- [ ] Commit/push with duplicate remote CI skipped, create and attach the pull request, merge and synchronize this checkout. Keep critical Pages publication enabled, dispatch its validated merged SHA and verify the actual public game and guide/release copy.

## Historical producer compatibility

Append an explicit compiled `FightRules` policy. The current compiler selects `Attributed`; authenticated historical reference adapters select `Published` and preserve their original fight decisions and random draws. Save version and cell layout never select this policy. Preserve frozen published wire records and require complete current contexts under both policies. A running player fight and an older automatic pending fight can coexist with distinct exact contexts. Validate both the immutable historical state oracle and an independently measured current native/browser hash.
