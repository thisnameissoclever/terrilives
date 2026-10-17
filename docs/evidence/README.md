# Verification records

Keep reproduction settings, written findings, source hashes, measurements,
failure and restoration receipts, and saved-game fixtures that let a later
developer investigate or repeat a check. Retain selected still images that
documentation or review tools name directly. Store bulk screenshot sequences
and temporary recordings in ignored `.scratch/` storage.

Some historical receipts list capture files that were removed during repository
cleanup. Those paths describe the original run; they do not promise that every
raw frame remains in the current checkout. The
[snapshot before cleanup](https://github.com/thisnameissoclever/terrilives/tree/7c7cfa2274729716b35fda168653c2dfe687d079/docs/evidence)
retains the original captures and review GIFs. Git can recover an individual
file from that revision when needed. Removing files from the current tree does
not remove their bytes from existing Git history or shrink an ordinary full
clone's historical objects.

Read dated reports as records of their inspected revision. Their local ports,
branch names, and readiness statements are historical context, not current
startup instructions or release approval. Use the repository README for the
current development commands.

Files under `docs/assets/review-evidence/` can be test inputs or asset production
sources. Check their readers before treating them as disposable captures.
