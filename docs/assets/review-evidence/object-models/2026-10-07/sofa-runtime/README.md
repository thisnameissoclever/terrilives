# Shared-sofa renderer verification

The production renderer passed 1488 comparisons against the authored sofa export. This includes 972 comparisons with actual uniform-colour source renders and 516 comparisons with mixed-colour references assembled from separately indexed owner contributions. Mixed-colour references are not independent source renders.

The maximum channel error was 4; the largest 95th-percentile error was 1. All recorded furniture and occupant hit tests passed. Each action arrangement and supported direction was checked. Static phase aliases were checked against their declared source identities.

The [complete receipt](proof.json) binds the export manifest and source index by SHA-256, a content fingerprint. The manifest fingerprint is `9e5c115063be22d46b8ccccd8104c548bd17a4fc508a9775d8d1697fe9c6d338`. The retained scripts reproduce the comparison on the local preview server. Screenshots show the production renderer with three readers in all four directions.

This verifies sofa rendering. It does not establish owner approval, fetch/return rendering, merge, or deployment.
