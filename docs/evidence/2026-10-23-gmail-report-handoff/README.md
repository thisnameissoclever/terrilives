# Gmail bug-report handoff

The prior formatter bounded the direct mail link. The configured Gmail handler escaped that link again, producing an oversized request and a visible Bad Request / Error 400. A controlled old-formatter report reproduced that failure in authenticated Chrome. The repaired report opened a populated draft; recipient, subject and the entire decoded body matched. No message was sent. Measurements and the actual compose screenshot are retained beside this record.

The formatter measures each generated request after the extra encoding and reserves 256 characters for the handler address within a 7,500-character application budget. The error and cause come first, followed by operation/source and bounded error details, build/current-attempt context, newest-first logs, and optional pending work/history/browser/timing. Optional sections and older logs yield space first. Copy and download retain their larger report.

`web/tests/startup-diagnostics.test.ts` covers varied sizes, reserved characters, Unicode, lone surrogates, newest-log retention, footer retention and content order. The initial order test rejected the earlier formatter. The browser proof checks the same outer budget through Options, failure and standalone sharing. The current game and standalone HTML use v4; cached older HTML keeps its original published script.

The browser automation interface interrupts external mail-scheme navigation. For the actual Gmail check, the app-generated link was wrapped using the configured Gmail handler address observed in the failing browser tab, then navigated directly. The proof establishes Gmail request and compose acceptance. Physical iOS mail handling and the original iPhone startup crash remain unverified. The original crash is a separate open investigation.

## Relevant verification selection

The candidate's local receipt is `.local-build/gmail-handoff-release/commands.json`. It records exact candidate/base, source identity, dependency-lock hash, environment, commands and actual outcomes. The selected checks cover docs/site generation, diagnostic/version/failure/Options web tests, types, syntax, production build and played browser reporting. No dedicated local manifest or exception command exists in this revision.

The player guide's existing instructions still describe the same controls, access paths and newest-details-that-fit behavior. Labels, layout, illustrations, effect mappings and numerical gameplay values do not change. Guide generation and reference checks remain selected; a repeated full guide interaction/image refresh is omitted because the repair changes email serialization and priority only. The actual Gmail compose screenshot receives fresh visual review. Rust, simulation, artwork and dependency changes are absent, so their suites are excluded. Hosted validation and paid review remain disabled; the relevant automatic Pages deployment remains enabled.
