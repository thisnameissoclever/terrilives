# Sparse relationship patch repair

Date: 2026-10-15

The merge review found that a character edit with a sparse `ties` group cleared every unsubmitted relationship to another living person. The application loop visited all current living relatives and treated an omitted pair as an explicit `None`. This violated `ES-atomic` in `docs/specs/2026-09-30-edit-sims.md`, which requires replacing only submitted pairs and preserving unrelated relationships.

The application now passes only the submitted pairs to `FamilyTies::set`. An explicit `None` still removes its named pair. The existing function retains canonical SimId ordering and inverse Parent/Child semantics. Validation still completes before application, including rejection of an explicitly named absent relative.

## Verification

Command for the setup, red, and green runs:

```text
cargo test --locked -j1 -p terri-sim character_draft::application::tests --lib -- --test-threads=1
```

1. Setup correction: `sparse-relationship-fixture-setup.log`, exit 101. The new fixture initially requested a `FamilyTies` resource before creating it. The shipped world creates this resource lazily. The fixture was corrected to initialize it explicitly; this run does not prove the production defect.
2. RED: `sparse-relationship-red.log`, exit 101. Five tests passed and two failed. Both the sparse assignment and explicit-clear regressions observed `None` where the unrelated sibling relationship had to remain `Some(Sibling)`. The mixed invalid-relative patch already rejected atomically.
3. GREEN: `sparse-relationship-green.log`, exit 0. All seven tests passed, including the three new regressions and four existing character application tests.

The new regressions exercise a sparse Parent assignment from the higher SimId, the inverse Child view, preservation of another living person's tie, preservation of an issued but absent identity's tie, explicit clearing of only one pair, and atomic rejection of a patch containing a valid relationship edit, an absent relative, and a name change. They also check that the relevant application and rejection paths preserve simulation randomness.

## Scope and remaining checks

Only `crates/terri-sim/src/character_draft/application.rs` changed for this repair. No dependency, command shape, validation domain, or save layout changed. The absent-identity fixture exercises preservation without a live entity; it does not simulate a death transition. Full native suites, the WebAssembly rebuild, browser persistence checks, and delivery remain with the main integration task. The shared native test lane was released after the green run.
