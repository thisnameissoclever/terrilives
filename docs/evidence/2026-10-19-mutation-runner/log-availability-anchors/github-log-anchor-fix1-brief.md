# Sanitize malformed HTTP response failures

Both frozen packet reviews identified only one P2: http.client.HTTPException can escape probe_job_logs with raw server text. The quality review's synthetic BadStatusLine reproduction is not a claim of an actual secret leak. The remaining lifecycle, anchor, preflight, sizing and accounting implementation is accepted subject to this repair.

Own only .github/scripts/mutation_recovery.py and test_mutation_recovery.py. You are not alone; preserve all other source and root YAML/docs. Root owns Git, evidence, review and dispatch. Do not edit workflow.main to catch arbitrary exceptions or hide programmer failures.

Sanitize the standard-library HTTPException family at the existing HTTP transport boundary, including malformed status/header failures. Keep the original fatal failure behavior, one charged request, no retry, no response-body read, no failed-result cache and safe resource identity. Do not include exception text, token, signed location or response body in structured failures or displayed exception context. A standard-library import is allowed; no dependency or tooling change is needed.

Add actual opener-boundary regression cases for BadStatusLine and another malformed header/status HTTPException. Verify safe error text, suppressed raw context, one request, no body/follow/cache, and unchanged fatal workflow classification where the existing focused harness can establish it. Run the affected HTTP/preflight checks and only relevant light consumers. No wrapper-budget or sizing rerun is justified because the public interface, request graph and proof schema must remain unchanged.

Use an isolated copy to remove only the new catch and require the named ordinary assertion failure, with an unchanged passing control and no import/syntax error. Preserve production bytes during controls. Freeze github-log-anchor-fix1-package.diff, hashes.json and report.md under this SDD directory, including exact commands and boundaries. Release ownership for the two existing reviewers' scoped re-review. No Git, API, workflow dispatch, browser or native execution.
