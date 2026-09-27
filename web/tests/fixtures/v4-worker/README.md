# Historical V4 browser writer

The two TypeScript files are byte-for-byte copies of `web/src/storage/`
from commit `7642930fd4aefa1eca552df35242e65bfae39865`, the head of the
selling-furniture branch, whose worker wrote V4. Tests execute this worker to
prove that a cached V4 client refuses a primary slot with header 5, as the V3
fixture proves for header 4. The browser filesystem is supplied by the test
harness; the guard is the historical production code.
