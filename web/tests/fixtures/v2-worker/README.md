# Historical V2 browser writer

The two TypeScript files are byte-for-byte copies of `web/src/storage/`
from commit `50540cda5bac856afa922387cf35f1c4e2ca8ba7`. Tests execute this
worker to prove that a cached V2 client refuses a primary slot with header 3.
The browser filesystem is supplied by the test harness; the guard is the
historical production code. This does not claim protection from older V1
workers that did not have the version guard or origin lock.
