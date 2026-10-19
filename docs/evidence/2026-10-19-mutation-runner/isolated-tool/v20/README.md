# V20 Windows inventory parity

The [report](report.md) and [independent review](independent-review.md) cover the native source at `0b886b73d8fb0492fe8e8029957e0fc1db5715a7`. Stock and patched cargo-mutants produced byte-identical ordered inventories containing 18,543 entries. Both executable digests remained unchanged. This follow-up reused the already qualified binaries; it did not repeat the build or selector tests.

[retention.json](retention.json) identifies retained reports and checker sources, their original and copied hashes, and the hashes of omitted bulk inventories and scoped-path snapshots. Copied text changes CRLF to LF only. Raw local files remain unchanged in the ignored execution directory named by the receipt. The helpers describe that original layout and are not supported commands to execute from this evidence folder.

The scoped proof compares indexed Git blobs and actual hashes of 358 generation files across four observations. It does not claim an actual-byte audit of every asset. The listing establishes neither Linux capacity nor mutation outcomes. The final committed Linux workflow must generate its own complete inventory and measurement evidence.
