# Published version 23 storage worker

These files are exact bytes from commit `e31afe2850aabb96d6e694ad01f3933d05fd3cca`:

1. `web/src/storage/save-header.ts`, SHA-256 `069188a9e0d375da16f7e788bd2f592686aa4c1fbbbf333ed5bf92b05dbc1089`.
2. `web/src/storage/save-worker.ts`, SHA-256 `4bcaee5121444aa09371033aaf9d24ae14b01eff87aa22f0e43bd2969dd1f0e1`.

The storage tests run this worker against a newer primary save. Its refusal must preserve the primary file and its recovery copies. Keep these historical files unchanged when the current writer advances.
