# Historical V3 browser writer

The two TypeScript files are byte-for-byte copies of `web/src/storage/`
from commit `cb2cb9acce1d8ffcac6ee011c3ef17317cd19ce5`, the last main commit
whose worker wrote V3. Tests execute this worker to prove that a cached V3
client refuses a primary slot with header 4, as the V2 fixture proves for
header 3. The browser filesystem is supplied by the test harness; the guard
is the historical production code.
