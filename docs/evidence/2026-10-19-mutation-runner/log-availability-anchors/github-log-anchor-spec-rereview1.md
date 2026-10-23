# Completed-job anchor specification re-review 1

Spec verdict: approved. The sole error-sanitization blocker is closed. No new specification defect was found in the two-file correction. This approval combines with the accepted areas of `github-log-anchor-spec-review.md`; it does not establish real Actions-token transport or Linux fixture qualification.

Verified fix package SHA-256 `7574ea70e4f5bf830180cc33854a0ff4c80cc0f5a896e34ae3caf25dc69463bc` against the original reviewed package `3e53b0ee8b52389f14c8de6604d67df5e6679dc643cad1ab789b827d67cfb221`. Both retained before files match that package's hashes and lengths. Both current changed files match the fix manifest:

| File | Verified current SHA-256 | Bytes |
| --- | --- | --- |
| `.github/scripts/mutation_recovery.py` | `f8b4898824f704d570ce5daad035fda62003605d7d663342e869771726f4f72a` | 50,059 |
| `.github/scripts/test_mutation_recovery.py` | `9dcbaf0af0411a494ed3e7fc65a68cca58bced35a98c4912534eb0f93c0cc9e9` | 56,079 |

1. The production correction adds only the standard-library import and `http.client.HTTPException` to the existing transport catch. The existing category-only `ValueError` with `from None` now handles malformed status/header failures without exposing their original messages or exception context. Failure remains fatal; no fallback, retry, successful cache entry or extra request is added.
2. The new actual-opener-boundary test covers `BadStatusLine` and `LineTooLong`, checks sanitized resource/category output and formatted tracebacks, and requires exactly one charge for each deliberate failed call with an empty successful-probe cache. The workflow harness verifies exit 22, `infrastructure_failure` and safe structured output. The existing five/seven-call preflight and stable-anchor lifecycle tests remain in the focused group.
3. Retained output records 14 tests passing in 0.793 seconds. The isolated control removes only the new catch member: both parser-error subcases then fail the intended ordinary `assertIsInstance(caught, ValueError)` assertion. The unchanged positive exits 0; the negative exits 1 without import or syntax errors. I inspected the receipt and transcript rather than repeating the run.
4. All six companion Python files retain their original reviewed hashes and lengths. The final root package hash is `8f3c3e39f29812a1e0c6f247ed2d5dcf78ea4d5b87b4748bf02b5a9a241289dc`. Its YAML and operations documentation remain unchanged from the reviewed versions. The sole lesson addition requires malformed status/header coverage and sanitized fatal errors without raw context; current lesson SHA-256 is `b12713e687f1a2ad7659dbe44715137e2de1981069e4067963fee9d6a49ce066`. All three root file hashes and lengths match.

The correction changes no public interface, anchor schema, request graph, native sizing, admission arithmetic, workflow permissions, limits or failure policy. Existing measured wrapper boundaries therefore remain applicable without repeating their expensive fixtures. The synthetic failures establish the repaired error path; no real secret leak was observed or claimed.

No source, test, Git state, API, browser or native process was changed or run by this re-review. Only this ignored report was written. Actual same-Actions-token preflight, fresh interrupted/uploaded/resumed Linux fixture qualification and complete production coverage remain root's release gates.

**Next steps**: Root can deliver the reviewed recipe and proceed with the already-authorized real-platform verification. No owner answer is needed.
