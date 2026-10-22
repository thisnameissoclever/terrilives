# Mutation runtime image

Mutation jobs use one Ubuntu 24.04 Linux amd64 container by its registry digest. The embedded `/opt/terrilives-mutation-runtime/inventory.json` records the installed executable, library, compiler, sysroot and symlink identities. Host runner labels remain provenance. They do not select the computation runtime.

`inputs.lock.json` pins the official Ubuntu base manifest, BuildKit manifest, dated Ubuntu package snapshot, direct package versions, Rust 1.94.1 component archives and GitHub CLI 2.102.1 archive. The recipe installs native and WebAssembly Rust standard libraries, Cargo, Clippy, rustfmt, Python 3, Git, GitHub CLI, GCC, the native linker, binutils, OpenSSL headers and certificates. Consumers perform no package installation or toolchain updates. They use isolated writable Cargo and target directories and do not mount host toolchain directories.

The four-file build context contains `Dockerfile`, `inputs.lock.json`, `inventory.py` and `.dockerignore`. The ignore file excludes everything else, including source assets and credentials. The image contains no game checkout. Ubuntu package signatures remain required. A checksum-pinned certificate package supplies HTTPS trust before the package installation step.

From the repository root, build and exercise the image with:

```powershell
python -B .github/scripts/mutation_runtime_image.py build --tag ghcr.io/thisnameissoclever/terrilives-mutation-runtime:source-REVIEWED_SHA --output .scratch/runtime-image --memory-gib 2
```

The helper creates its own digest-pinned BuildKit container with two CPU equivalents and a memory limit of 1 to 4 GiB. The default is 4 GiB for the publication runner; the local command above uses 2 GiB. It removes that builder in a `finally` block. Verification uses the same resource limits, an unprivileged UID, a read-only image, a writable temporary filesystem and no network. It checks the complete embedded inventory, native compilation and execution, WebAssembly compilation, Cargo tests, Clippy, formatting, Git ownership, isolated Cargo state, process-group shutdown and writable artifact output. Keep other heavy checks separate on a shared machine.

Verification also requires two deliberate faults to fail: redirecting `/usr/bin/sh` from Dash to Bash while preserving both binaries, and shadowing the assembler through `PATH` with an identical binary copy. These controls run as root in a separate disposable container layer, with no network or host mounts. Each restores the baseline and verifies it again. A fault accepted by the runtime guard prevents publication.

Only the owner-dispatched image publication job receives package-write permission. It builds the reviewed revision, then runs:

```sh
python3 -B .github/scripts/mutation_runtime_image.py publish \
  --tag "ghcr.io/thisnameissoclever/terrilives-mutation-runtime:source-$GITHUB_SHA" \
  --output .scratch/runtime-image
```

Publication uses `GH_TOKEN` or `GITHUB_TOKEN` and `GITHUB_ACTOR` from that job. The helper removes token variables from build and verification subprocess environments. It sends the publication token to Docker over standard input, stores registry authentication in a temporary Docker configuration and logs out before removing it. It obtains the pushed repository digest and reads that immutable registry manifest. It writes `image-receipt.json`, the canonical embedded `inventory.json`, and the `image` and `inventory_sha256` GitHub step outputs.

Use the receipt's real image digest, inventory hash and recipe-file hashes for the committed `pin.json`. Never fill the pin with a tag or a proposed digest. The receipt also records the source revision and publication run ID. Rebuilding the image creates a new candidate; consumers continue using the reviewed digest until the pin is deliberately changed and qualified.

The official input sources are [Ubuntu's container image](https://hub.docker.com/_/ubuntu), the [Ubuntu package snapshot](https://snapshot.ubuntu.com/), the [Rust 1.94.1 distribution manifest](https://static.rust-lang.org/dist/channel-rust-1.94.1.toml), [GitHub CLI's immutable release](https://github.com/cli/cli/releases/tag/v2.102.1), its [published checksums](https://github.com/cli/cli/releases/download/v2.102.1/gh_2.102.1_checksums.txt), and [BuildKit's release](https://github.com/moby/buildkit/releases/tag/v0.28.0). The lock contains the exact downloaded-byte hashes; the final image digest and embedded inventory identify what actually ran.
