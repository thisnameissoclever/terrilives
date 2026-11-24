# Published V21 save controls

These files were produced by the actual public game binary deployed from commit `4b537037e10c8f3c0169f385a49c4da9c4b311b1`, before the combined editable-world, pool and bath writer. The binary SHA-256 is `a73ca0bb02253837a71d83ae8b6e98b0ac840dcb88bcfc0b002023e5649585e1`. The manifest records each unchanged file hash, actual header and public commands used to create its state.

The existing local generated JavaScript adapter was used with that frozen binary after its imports and required exports were checked. The adapter is an interface to the original producer; it does not define the serialized save. Its origin and hash are recorded separately.

The controls cover the shipped household, a nonstandard held shift with a same-day change, mixed queued shift and household commands, and actual active work attendance. Preserve these bytes. Do not recreate them with the current writer or relabel a current payload as V21.
