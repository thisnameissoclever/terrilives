# Required Bike Contact Compilation Implementation Plan

> For implementation: use the existing two worker ownership assignments. This plan does not authorize another worker or publication.

**Goal:** Compile each admitted body's complete bike contact cycle before it can reach production rendering, while preserving the existing geometry, fitting math, and sampled poses.

**Architecture:** Pure sparse extraction creates a versioned serializable input from the same configured joint setup used by pose sampling. One CPU worker compiles an immutable whole-cycle artifact. A bounded owner-lease service retains only current live configurations, the newest draft, and at most one superseded in-flight job. Production rendering requires the admitted artifact; it never starts a search.

**Tech stack:** Existing TypeScript, native module Worker, Vitest, structured clone, and current geometry assets. No dependency, native API, or save-format changes.

**Spec:** The owner-authorized repair plan and the fresh bike-contact-cost review select required configuration-time compilation. See `2026-10-13-creator-repair.md` and the retained surface-query measurements.

## Ownership and constraints

1. Math/service worker owns bike input, compiler, protocol, worker, service, necessary shared joint-setup extraction, strict pose consumption, and focused CPU tests.
2. Integration worker owns startup/load/create/edit admission, live/draft owner IDs, preview readiness, artifact binding, and GPU-resource-independent lifetime.
3. Root owns final actual-game visual, GPU, responsiveness, performance, and independent review.
4. Preserve approved body ranges, candidate traversal and selection order, arithmetic, contacts, fixture placement, and animation phase. Do not introduce synchronous render fallback, substituted poses, simulation randomness, or unbounded historical caches.
5. Use one coordinated heavy test lane and a 4 GiB heap. No local GPU work in the math/service lane.

## Agreed interfaces

1. `BikeContactInputV1`, `BikeContactArtifactV1`, and protocol validation live in contact-specific modules. Artifacts include a complete existing `BikeFit`, revision/key metadata, and finite validated values.
2. `compileBikeContact(input)` is pure expensive construction. `sampleBikeContact(artifact, angle)` is pure cheap phase sampling.
3. `BikeContactService.acquire(owner, appearance)` returns a lease with owner, generation, appearance key, ready promise, and release. `require(owner, appearance)` synchronously returns the current admitted artifact or throws a typed not-ready error. `release`, `dispose`, and compact diagnostics complete the ownership interface.
4. `bikeContactAppearanceKey(appearance)` is cheap and omits uniform-only and non-contact choices. Exact tests establish which selectors can be omitted. The worker key also binds input/solver versions, source/fixture/shoe revisions, and serialized actual contact input.
5. Default extraction uses the immutable `loadCreatorRig('exercise')` base arrays with selected part descriptors and supplemental fixture geometry. It does not compact or upload a common body.
6. `configuredPose(..., geometry?, bikeContact?)` requires an artifact for exercise. A separately named `configuredPoseForProof` supplies explicit synchronous compilation only for CPU asset/geometry tests.

## Work and evidence

1. Extract the existing configured-joint setup and pelvis-height alignment without changing its operations. Build minimal hip/saddle/sole surfaces and source/rest measurements. Compare extracted actual inputs across authored and fractional phases, presentations, every body corner, supported footwear, and seeded interior profiles. Check ignored appearance selectors independently.
2. Move the unchanged stationary/periodic solver behind `compileBikeContact`. Keep the existing strict full-fit golden fixtures and independent old implementations. Compare cold artifacts and all phase samples; retain contact and continuity checks independently of solver metadata.
3. Add a validated versioned worker protocol and one-worker transport, plus injectable fake transport. Implement owner generations, coalescing, stale-result rejection, release, failure handling, queue bounds, and disposal. Test A-B-A, shared owners, cancellation while queued/in-flight, errors, malformed messages, and no historical retention.
4. Make strict pose consumption the production interface. Update explicit CPU proof callers and tests. The integration worker binds artifacts and gates all admission paths before the new strict path is exercised in the browser.
5. Run coordinated focused tests and type checks. Preserve exact commands, outputs, hashes, worker counts, pending counts, and timings. Root then verifies real startup/load/create/edit/recovery, zero rendering-time construction, worker preparation latency, and the six-person/two-preview frame target.

## Review focus

1. A superseded job must not publish into a newer live or draft configuration, including A-B-A edits.
2. Loading or editing a person already exercising must remain transactional until their required artifact is ready.
3. GPU loss must not invalidate valid CPU artifacts or duplicate the worker.
4. A compile or protocol failure must be reported through admission and must not produce a substitute pose or a synchronous search.
5. Cached-phase comparisons must not be presented as proof of cold phase independence. Compare actual extracted inputs before compiling and keep source/model revisions in the key.
