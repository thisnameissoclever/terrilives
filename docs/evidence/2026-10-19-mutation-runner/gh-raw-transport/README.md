# Captured GitHub CLI byte transport

The newer GitHub command-line client refused captured job logs containing terminal escape bytes. The adapter now detects support offline and enables exact raw output only into captured streams. Older clients keep their original request arguments. Authentication, request accounting, strict metadata parsing, caps and failure propagation remain unchanged.

The frozen repair passed 37 focused tests and independent specification and quality review. The old-client positive control passed; removing its capability condition failed at the intended assertion. One real Windows-host fetch returned the original 21,136 bytes with the expected SHA-256. These checks establish transport behavior, not Linux interruption/recovery qualification or game mutation coverage.

The report, scoped review, tests, controls and byte hashes are retained here. Text copies use LF and remove trailing whitespace; retention.json records both original and retained hashes. Raw ignored originals remain unchanged. The public changelog needs no additional note because this repair has no player-visible effect.
