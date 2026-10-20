# Raw GitHub transport scoped review

Spec verdict: approved. Quality verdict: approved. No actionable defect was found in this two-file repair or its caller integration. The earlier whole-branch review remains applicable outside this supplement.

Reviewed the brief, report, exact diff, both current files, retained before files, focused test output, control transcripts and host-proof metadata. Starting source: `0a7ee7b2ceef3a7737d9ad41844f88326e1b837e`. Package SHA-256 verified: `4f9f5e51b0aee91e3a9690cd5787c91ed5efb605b0295c63023d0ff5d834601f`.

| File | Verified before SHA-256 | Verified current SHA-256 |
| --- | --- | --- |
| `.github/scripts/mutation_artifacts.py` | `b377e388941fbb842b0a8c63d5eb27018bd86dfe8f78e373068580fb67639b4b` | `c307eb155202c2bc49acf7c00e4e51d1f13b3dca5ebba30cca17835f7434dddd` |
| `.github/scripts/test_mutation_artifacts.py` | `d60d2bba018d05c160fccfd2e554eef2975ee7fb8771e87f80e60489aeffe01f` | `f983814c816f81f2b60e3c3e9bf6b477c9fb4cb4b3be23b1b118d5784b0bb10d` |

All four file lengths also match the manifest: 29,210/29,786 bytes for the adapter and 18,374/24,280 bytes for its tests.

1. `mutation_artifacts.py:234` checks the repository endpoint before probing. The client captures one offline `gh api --help` result and enables `--allow-escape-sequences` only when the help advertises that flag. Unsupported versions retain the prior request argv. Successful capability detection is cached only on that client instance. No installed tool, environment override or persistent cache is added.
2. Both subprocess streams stay captured, and the request returns original stdout bytes directly. Nothing decodes, strips, renders or rewrites escape sequences or ZIP bytes. The new behavior therefore repairs transport before the existing digest, archive and producer-log validators. `json()` still calls `strict_json(self.bytes(path))`; duplicate keys and nonfinite constants remain rejected.
3. Probe failures propagate before any repository request. Request failures propagate without a retry or fallback. The existing 60-second subprocess bound remains on the request; the separate offline probe is also bounded at 60 seconds. Public `bytes(path)` and `json(path)` interfaces remain unchanged, including the runner's direct clients and the recovery wrapper.
4. `WorkflowAPI` still charges repository HTTP operations outside this adapter. The added subprocess performs no HTTP request. The new wrapper test verifies three charged requests for one uncached metadata read and two byte reads, with a repeated metadata read served from cache. Rate-limit and redirect probes are unchanged. Fixture API injection remains independent of the production CLI adapter.
5. Retained focused output records 37 tests passing in 1.184 seconds. The old-CLI positive control passes; removing only capability-conditional flag selection produces the named ordinary argv assertion failure, without import or syntax errors. That mutation directly tests the compatibility requirement. The new-CLI tests also assert exact ESC/NUL/non-UTF-8 log bytes, ZIP bytes and metadata parsing.
6. Retained host proof records one offline probe and one authorized log request returning 21,136 bytes, SHA-256 `c7f36f5fa1b6376a455c5a44d13c8de76220ae2aca5b92f5fa844fcb8eeddc9b`, matching the known original. I inspected the receipt; I did not repeat the fetch or render the raw log. Old-CLI and ZIP compatibility remain deterministic fixture evidence. This host result does not establish fresh Linux qualification or production mutation coverage.

No tests, live requests, Git operations, browser work, native build or source edits were performed during this review. Only this ignored review report was written. Internal CLI transport compatibility requires no player-guide, screenshot or public changelog change.

**Next steps**: Root can deliver this reviewed recipe change and run the already-authorized fresh fixture. Existing full Linux results retain their original boundary; final-recipe qualification and the remaining native campaign gates still apply. No user answer is needed.
