"""Authenticate the mutation container separately from its hosting machine."""

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil

import mutation_artifacts as artifacts

require = artifacts.require
PIN = ".github/runtime/pin.json"
WORKFLOW = ".github/workflows/ci.yml"
RECIPE_PATHS = (".github/runtime/Dockerfile", ".github/runtime/inputs.lock.json",
                ".github/runtime/inventory.py", ".github/runtime/.dockerignore")
INVENTORY = Path("/opt/terrilives-mutation-runtime/inventory.json")
CONTAINER_MARKER = Path("/.dockerenv")
CGROUP = Path("/proc/1/cgroup")
REQUIRED_TOOLS = frozenset(("rustc", "cargo", "cc", "c++", "ld", "ar", "readelf", "ldd",
                            "git", "gh", "python3", "bash", "tar", "gzip", "uname", "sh", "as",
                            "gcc", "g++", "cpp", "dash", "env", "sleep", "mkdir", "rm"))
IMAGE_PATTERN = r"ghcr\.io/thisnameissoclever/terrilives-mutation-runtime@sha256:([0-9a-f]{64})"


def canonical(value):
    # The published inventory escapes Unicode paths before hashing its bytes.
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n").encode()


def file_sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def hash_value(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None and value != "0" * 64


def host_provenance(environ=None):
    inherited = os.environ if environ is None else environ
    return {**{key: inherited[key] for key in ("ImageOS", "ImageVersion") if key in inherited},
            **{key: value for key, value in inherited.items() if key.startswith("RUNNER_")}}


def identity(root, environ=None):
    inherited = os.environ if environ is None else environ
    require(platform.system() == "Linux", "unsupported mutation runtime platform")
    require(not any(key.startswith(("LD_", "DYLD_")) for key in inherited), "loader override is forbidden")
    root = Path(root)
    pin_raw = (root / PIN).read_bytes()
    pin = artifacts.strict_json(pin_raw)
    require(isinstance(pin, dict) and set(pin) == {"version", "image", "inventory_sha256", "recipe_files"}
            and type(pin["version"]) is int and pin["version"] == 1, "invalid mutation runtime pin")
    image = pin["image"]
    match = re.fullmatch(IMAGE_PATTERN, image) if isinstance(image, str) else None
    require(match is not None and hash_value(match.group(1)) and hash_value(pin["inventory_sha256"]),
            "mutation runtime requires a real immutable image and inventory pin")
    require(inherited.get("MUTATION_RUNTIME_IMAGE") == image, "mutation runtime image differs from committed pin")
    literals = re.findall(r"^\s+MUTATION_RUNTIME_IMAGE:\s+(?:&[A-Za-z0-9_-]+\s+)?([^\s#]+)\s*$",
                          (root / WORKFLOW).read_text(encoding="utf-8"), re.MULTILINE)
    require(literals == [image], "mutation runtime image differs from committed workflow literal")
    recipe = pin["recipe_files"]
    require(isinstance(recipe, dict) and recipe and all(path in RECIPE_PATHS and hash_value(value)
            for path, value in recipe.items()), "invalid mutation runtime recipe inventory")
    # The publisher and documentation do not influence the installed computation.
    require(set(recipe) == set(RECIPE_PATHS), "incomplete mutation runtime recipe inventory")
    for path, expected in recipe.items():
        require(file_sha(root / path) == expected, "mutation runtime recipe changed: " + path)
    require(CONTAINER_MARKER.is_file() and CGROUP.is_file() and CGROUP.read_text().strip(),
            "mutation runtime requires an actual container marker")
    raw = INVENTORY.read_bytes()
    require(artifacts.sha(raw) == pin["inventory_sha256"], "mutation runtime inventory hash changed")
    inventory = artifacts.strict_json(raw)
    require(isinstance(inventory, dict) and set(inventory) == {"version", "architecture", "files", "tools",
        "tool_versions", "compiler", "recipe_inputs", "symlinks"} and type(inventory["version"]) is int
        and inventory["version"] == 1 and canonical(inventory) == raw, "invalid canonical mutation runtime inventory")
    require(inventory["recipe_inputs"] == recipe, "mutation runtime inventory recipe differs from committed pin")
    require(inventory["architecture"] == platform.machine() == "x86_64", "mutation runtime architecture changed")
    files, tools = inventory["files"], inventory["tools"]
    require(isinstance(files, dict) and files and isinstance(tools, dict) and REQUIRED_TOOLS <= set(tools),
            "incomplete mutation runtime executable inventory")
    for name, expected in files.items():
        path = Path(name)
        require(path.is_absolute() and str(path.resolve(strict=True)) == name and path.is_file() and hash_value(expected),
                "invalid mutation runtime file identity")
        require(file_sha(path) == expected, "mutation runtime file changed: " + name)
    links = inventory["symlinks"]
    require(isinstance(links, dict), "invalid mutation runtime symlink inventory")
    for name, expected in links.items():
        path = Path(name)
        require(path.is_absolute() and isinstance(expected, str) and Path(expected).is_absolute()
                and path.is_symlink() and str(path.resolve(strict=True)) == expected,
                "mutation runtime symlink changed: " + name)
    for name, expected in tools.items():
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_+.-]+", name) and expected in files,
                "invalid mutation runtime tool identity")
        actual = shutil.which(name, path=inherited.get("PATH", ""))
        require(actual is not None and str(Path(actual).resolve(strict=True)) == expected,
                "mutation runtime tool resolution changed: " + name)
    versions, compiler = inventory["tool_versions"], inventory["compiler"]
    require(isinstance(versions, dict) and set(versions) == set(tools) | {"packages"}
            and all(isinstance(value, str) and value for value in versions.values()), "invalid runtime tool versions")
    require(isinstance(compiler, dict) and set(compiler) == {"sysroot", "target", "verbose"}
            and isinstance(compiler["sysroot"], str) and Path(compiler["sysroot"]).is_absolute()
            and compiler["target"] == "x86_64-unknown-linux-gnu"
            and isinstance(compiler["verbose"], str) and compiler["verbose"].startswith("rustc 1.94.1"),
            "invalid runtime compiler identity")
    return {"version": 1, "image": image, "inventory_sha256": pin["inventory_sha256"],
        "pin_sha256": artifacts.sha(pin_raw), "architecture": inventory["architecture"],
        "tools": tools, "compiler": compiler}


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify",))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(json.dumps({"runtime": identity(args.root), "host_provenance": host_provenance()}, sort_keys=True))


if __name__ == "__main__":
    main()
