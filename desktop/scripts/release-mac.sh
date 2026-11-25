#!/bin/sh
# Builds the Mac disk images and adds them to the draft GitHub release.
# Run from anywhere inside the repository on a Mac:
#   sh desktop/scripts/release-mac.sh [--dry-run] [--replace]
set -eu

missing=0
check() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing: $1. $2" >&2
    missing=1
  fi
}

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Missing: Xcode command line tools. Run: xcode-select --install" >&2
  missing=1
fi
check rustup "Install Rust from https://rustup.rs"
check wasm-pack "Install it with: cargo install wasm-pack --version 0.15.0"
check node "Install Node 22.12 or later from https://nodejs.org"
check gh "Install the GitHub CLI from https://cli.github.com and run: gh auth login"
if [ "$missing" -ne 0 ]; then
  exit 1
fi

root=$(git rev-parse --show-toplevel)
cd "$root"
exec node desktop/scripts/release.js --mac "$@"
