"""One pinned Linux executable, authenticated independently of result artifacts."""

import base64
import datetime as dt
import io
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_runner as runner

require = artifacts.require
UPSTREAM = "8ab1dc786a1f61a4e370416cc6c68b81a704e917"
PATCH = ".github/cargo-mutants-27.1.0-struct-filter.patch"
PATCH_SHA = "6693b7a61b4c7cb398e199c4e33675f9267bc50559790e069341be377f32ba6f"
SOURCE_TREE = "2f083ac6d2d2e88bf99e863b0b0f74774f986005"
LOCK_SHA = "0d2699c31955d28f429731eda2972dc4faced07747320b074bc774c3334f75c0"
# A transport capacity bound, not a claim about measured binary size.
TOOL_LIMIT = 256 * 1024 * 1024
RECEIPT_LIMIT = 1024 * 1024
WORKFLOW = ".github/workflows/ci.yml"
CONTRACT_PATHS = (WORKFLOW, PATCH, "rust-toolchain.toml",
    ".github/scripts/mutation_tool.py", ".github/scripts/mutation_workflow.py",
    ".github/scripts/mutation_qualification.py", ".github/scripts/mutation_recovery.py", ".github/scripts/mutation_runner.py",
    ".github/scripts/mutation_artifacts.py", ".github/scripts/mutation_campaign.py")
MARGIN = dt.timedelta(days=2)


def committed_contract(root):
    contents = {path: (Path(root) / path).read_bytes() for path in CONTRACT_PATHS}
    paths = {path: artifacts.sha(raw) for path, raw in contents.items()}
    blobs = {path: hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
             for path, raw in contents.items()}
    require(paths[PATCH] == PATCH_SHA, "reviewed patch changed")
    return {"version": 1, "files": paths, "git_blobs": blobs, "upstream": UPSTREAM, "patch_sha256": PATCH_SHA,
            "fixture_digest": model.digest({"Cargo.toml": runner.FIXTURE_CARGO,
                "Cargo.lock": runner.FIXTURE_LOCK, "src/lib.rs": runner.FIXTURE_SOURCE,
                "rust-toolchain.toml": (Path(root) / "rust-toolchain.toml").read_text(encoding="utf-8")})}


def verify_committed_contract(api, repository, revision, contract):
    require(set(contract["files"]) == set(CONTRACT_PATHS), "unexpected recipe paths")
    commit = api.json(f"repos/{repository}/git/commits/{revision}")
    require(commit["sha"] == revision, "recipe commit mismatch")
    tree = api.json(f"repos/{repository}/git/trees/{commit['tree']['sha']}?recursive=1")
    require(tree.get("truncated") is False, "recipe Git tree is truncated")
    rows = {row["path"]: row for row in tree["tree"]}
    for path in contract["files"]:
        require(path in rows and rows[path]["type"] == "blob"
                and rows[path]["mode"] in ("100644", "100755") and rows[path]["sha"] == contract["git_blobs"][path],
                "committed recipe input mismatch: " + path)


def runtime_identity(executable, root, image):
    require(os.name == "posix" and image.get("ImageOS") == "ubuntu24", "unsupported tool runtime")
    require(not any(key.startswith(("LD_", "DYLD_")) for key in os.environ), "loader override is forbidden")
    env, _ = runner.execution_environment({"opt_level": 2, "cargo_jobs": 2, "runner_image": image})
    header = runner.command(["readelf", "-l", str(executable)], root, env)
    interpreter = re.search(r"Requesting program interpreter: ([^\]]+)", header)
    require(interpreter is not None, "missing ELF interpreter")
    libraries = {}
    dynamic = runner.command(["ldd", str(executable)], root, env)
    require("not found" not in dynamic, "missing loaded library")
    for line in dynamic.splitlines():
        match = re.search(r"(?:=>\s+)?(/\S+)\s+\(", line)
        if match:
            path = Path(match[1]).resolve(strict=True)
            libraries[str(path)] = artifacts.sha(path.read_bytes())
    loader = Path(interpreter.group(1)).resolve(strict=True)
    libraries[str(loader)] = artifacts.sha(loader.read_bytes())
    require(len(libraries) >= 2, "incomplete dynamic runtime identity")
    return {"image": image, "architecture": runner.command(["uname", "-m"], root, env),
            "interpreter": str(loader), "libraries": libraries,
            "toolchain": {name: runner.command([name, "--version", "--verbose"], root, env)
                          for name in ("rustc", "cargo")}}


def unpack_tool(raw):
    require(len(raw) <= TOOL_LIMIT + RECEIPT_LIMIT, "tool archive exceeds limit")
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.infolist()) == 2, "unexpected tool archive members")
        for member in archive.infolist():
            artifacts.safe_path(member.orig_filename)
            artifacts.safe_path(member.filename)
            require(member.filename in {"cargo-mutants", "receipt.json"} and member.filename not in result,
                    "unexpected or duplicate tool archive member")
            require(not member.is_dir() and stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG)
                    and not member.flag_bits & 1, "nonregular tool archive member")
            limit = TOOL_LIMIT if member.filename == "cargo-mutants" else RECEIPT_LIMIT
            require(0 < member.file_size <= limit, "tool member exceeds limit")
            with archive.open(member) as stream:
                data = stream.read(limit + 1)
            require(len(data) == member.file_size, "tool member size mismatch")
            result[member.filename] = data
    return result


def entry_from_receipt(receipt):
    checkout = receipt["checkout"]
    return dict(run_id=receipt["run_id"], head_sha=receipt["head_sha"],
                workflow_sha=receipt["workflow_sha"], commit=checkout["commit"],
                tree=checkout["tree"], ref=checkout["ref"], predecessor=None)


def retained_until(api, repository, artifact, run, required_until, original_days=None):
    require(not artifact["expired"] and artifacts.timestamp(artifact["expires_at"]) > required_until,
            "artifact retention cannot cover campaign and recovery margin")
    # This runner-provided value requires no Administration permission. A current
    # reduction cannot extend old evidence; callers also supply its recorded value.
    days = int(os.environ["GITHUB_RETENTION_DAYS"])
    if original_days is not None:
        require(type(original_days) is int and original_days > 0, "invalid recorded log retention")
        days = min(days, original_days)
    require(days > 0 and
            artifacts.timestamp(run["created_at"]) + dt.timedelta(days=days) > required_until,
            "job log retention cannot cover campaign and recovery margin")


def authenticate(api, reference, contract, destination, root, image, required_until, *, runtime=runtime_identity):
    repository = reference["repository"]
    artifact = api.json(f"repos/{repository}/actions/artifacts/{reference['artifact_id']}")
    require(artifact["id"] == reference["artifact_id"] and
            artifact["digest"] == reference["archive_digest"], "tool artifact reference mismatch")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact['id']}/zip")
    require(artifact["digest"] == "sha256:" + artifacts.sha(raw), "tool archive byte digest mismatch")
    files = unpack_tool(raw)
    receipt = artifacts.strict_json(files["receipt.json"])
    require(artifacts.sha(files["receipt.json"]) == reference["receipt_sha256"], "tool receipt digest mismatch")
    require(receipt["version"] == 1 and receipt["repository"] == repository and
            receipt["contract"] == contract and receipt["upstream"] == UPSTREAM and
            receipt["patch_sha256"] == PATCH_SHA and receipt["source_tree"] == SOURCE_TREE
            and receipt["lock_sha256"] == LOCK_SHA, "tool recipe mismatch")
    require(all(receipt[key] == reference[key] for key in ("run_id", "attempt", "job_id")), "tool producer reference mismatch")
    require(artifact["name"] == f"mutation-tool-run-{receipt['run_id']}-attempt-{receipt['attempt']}"
            and str(artifact["workflow_run"]["id"]) == receipt["run_id"]
            and artifact["workflow_run"]["head_sha"] == receipt["head_sha"], "tool artifact producer mismatch")
    require(artifacts.sha(files["cargo-mutants"]) == reference["executable_sha256"] == receipt["executable_sha256"]
            and len(files["cargo-mutants"]) == receipt["executable_size"], "tool executable byte mismatch")
    entry = entry_from_receipt(receipt)
    run = artifacts.authenticate_run(api, repository, WORKFLOW, entry, contract["files"][WORKFLOW])
    require(run["event"] == "workflow_dispatch", "tool requires explicit fixture dispatch")
    retained_until(api, repository, artifact, run, required_until, receipt["log_retention_days"])
    verify_committed_contract(api, repository, receipt["workflow_sha"], contract)
    verify_committed_contract(api, repository, receipt["checkout"]["commit"], contract)
    artifacts.authenticate_producer(api, repository, entry, artifact, receipt,
        now=dt.datetime.now(dt.timezone.utc), job_name="mutation-fixture-tool", marker="MUTATION_TOOL")
    jobs = list(artifacts.pages(api, f"repos/{repository}/actions/runs/{receipt['run_id']}/attempts/{receipt['attempt']}/jobs", "jobs"))
    require(any(str(job["id"]) == receipt["job_id"] and job["conclusion"] == "success" and
                job["status"] == "completed" for job in jobs), "tool producer did not succeed")
    destination = Path(destination).resolve()
    require(not destination.is_relative_to(Path(root).resolve()) and not destination.exists(), "tool destination must be fresh and external")
    destination.mkdir(parents=True)
    executable = destination / "cargo-mutants"
    executable.write_bytes(files["cargo-mutants"])
    executable.chmod(0o700)
    current_runtime = runtime(executable, root, image)
    require(current_runtime == receipt["runtime"], "tool runtime changed")
    require(artifacts.sha(executable.read_bytes()) == reference["executable_sha256"], "tool changed during runtime inspection")
    return executable, {"reference": reference, "runtime": current_runtime, "recipe": contract}


def consume_prepared(api, reference, receipt, contract, destination, root, image, required_until, *, runtime=runtime_identity):
    """The authenticated current preparation retained the original tool proof."""
    require(receipt["contract"] == contract and receipt["upstream"] == UPSTREAM and receipt["patch_sha256"] == PATCH_SHA
            and receipt["source_tree"] == SOURCE_TREE and receipt["lock_sha256"] == LOCK_SHA,
            "prepared tool recipe changed")
    artifact = api.json(f"repos/{reference['repository']}/actions/artifacts/{reference['artifact_id']}")
    require(artifact["id"] == reference["artifact_id"] and artifact["digest"] == reference["archive_digest"]
            and artifact["name"] == f"mutation-tool-run-{receipt['run_id']}-attempt-{receipt['attempt']}"
            and str(artifact["workflow_run"]["id"]) == receipt["run_id"]
            and artifact["workflow_run"]["head_sha"] == receipt["head_sha"]
            and not artifact["expired"] and artifacts.timestamp(artifact["expires_at"]) > required_until,
            "prepared tool artifact changed or expired")
    raw = api.bytes(f"repos/{reference['repository']}/actions/artifacts/{reference['artifact_id']}/zip")
    require("sha256:" + artifacts.sha(raw) == reference["archive_digest"], "prepared tool archive changed")
    files = unpack_tool(raw)
    require(artifacts.sha(files["receipt.json"]) == reference["receipt_sha256"]
            and artifacts.strict_json(files["receipt.json"]) == receipt, "prepared tool receipt changed")
    require(artifacts.sha(files["cargo-mutants"]) == reference["executable_sha256"] == receipt["executable_sha256"]
            and len(files["cargo-mutants"]) == receipt["executable_size"], "prepared executable changed")
    destination = Path(destination).resolve()
    require(not destination.is_relative_to(Path(root).resolve()) and not destination.exists(), "tool destination must be fresh and external")
    destination.mkdir(parents=True)
    executable = destination / "cargo-mutants"
    executable.write_bytes(files["cargo-mutants"])
    executable.chmod(0o700)
    current = runtime(executable, root, image)
    require(current == receipt["runtime"], "prepared tool runtime changed")
    require(artifacts.sha(executable.read_bytes()) == reference["executable_sha256"], "prepared executable changed during inspection")
    return executable, {"reference": reference, "runtime": current, "recipe": contract}


def reference_for(api, repository, artifact_id):
    artifact = api.json(f"repos/{repository}/actions/artifacts/{artifact_id}")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact_id}/zip")
    require(artifact["digest"] == "sha256:" + artifacts.sha(raw), "tool archive digest mismatch")
    files = unpack_tool(raw)
    receipt = artifacts.strict_json(files["receipt.json"])
    return {"repository": repository, "artifact_id": artifact_id, "archive_digest": artifact["digest"],
            "receipt_sha256": artifacts.sha(files["receipt.json"]), "executable_sha256": receipt["executable_sha256"],
            **{key: receipt[key] for key in ("run_id", "attempt", "job_id")}}


def selector_probe(executable, root, environment, directory):
    """Exercise the exact upstream defect through both public selection surfaces."""
    directory = Path(directory)
    (directory / "src").mkdir(parents=True)
    (directory / "Cargo.toml").write_text('[package]\nname="selector-probe"\nversion="0.1.0"\nedition="2021"\n[workspace]\n')
    (directory / "src/lib.rs").write_text('#[derive(Default)] pub struct Pair { pub a: u32, pub b: u32 }\n'
        'pub fn pair(x: u32) -> Pair { Pair { a: x + 1, b: x + 2, ..Default::default() } }\n')
    (directory / "rust-toolchain.toml").write_bytes((Path(root) / "rust-toolchain.toml").read_bytes())
    prefix = [str(executable), "mutants", "--list", "--json"]
    def listing(args):
        return artifacts.strict_json(runner.command(prefix + args, directory, environment))
    full = listing(["--no-config"])
    fields = [item["name"] for item in full if item["genre"] == "StructField"]
    ordinary = next(item["name"] for item in full if item["genre"] != "StructField")
    require(len(fields) == 2, "selector probe requires two same-line fields")
    def anchor(name):
        return "^" + re.sub(r"([\\.^$|?*+()\[\]{}])", r"\\\1", name) + "$"
    for config in (False, True):
        for include, exclude, expected in ((["^NOT_A_MUTATION$"], [], []),
            ([anchor(fields[0])], [], [fields[0]]),
            ([anchor(ordinary)], [], [ordinary]),
            ([anchor(name) for name in fields], [anchor(fields[0])], [fields[1]]),
            ([], [anchor(fields[0])], [item["name"] for item in full if item["name"] != fields[0]])):
            if config:
                path = directory / "selection.toml"
                path.write_text("examine_re = " + json.dumps(include) + "\nexclude_re = " + json.dumps(exclude) + "\n")
                args = ["--config", str(path)]
            else:
                args = ["--no-config"] + [value for pattern in include for value in ("--re", pattern)]
                args += [value for pattern in exclude for value in ("--exclude-re", pattern)]
            require([item["name"] for item in listing(args)] == expected, "patched selector regression")
    return {"cases": 10, "inventory_sha256": model.digest(full), "same_line_fields": fields}


def build(root, settings, output):
    """Only the slot-zero fixture producer calls this; logs remain outside marker stdout."""
    runner.bound_setup(settings)
    require(settings["scope"] == "fixture" and settings["slot"] == 0, "tool build requires fixture slot zero")
    root, output = Path(root).resolve(), Path(output).resolve()
    require(not output.is_relative_to(root), "tool build output overlaps checkout")
    contract = committed_contract(root)
    checkout, _ = runner.checkout_inventory(root, settings["repository"])
    output.mkdir(parents=True)
    source = output.parent / "tool-source"
    env, _ = runner.execution_environment(settings)
    # Compiler inputs are explicit, and the API token never enters the compiler environment.
    runner.command(["git", "clone", "--quiet", "https://github.com/sourcefrog/cargo-mutants.git", str(source)], root, env)
    runner.command(["git", "checkout", "--quiet", "--detach", UPSTREAM], source, env)
    require(runner.command(["git", "rev-parse", "HEAD"], source, env) == UPSTREAM, "upstream commit mismatch")
    lock = artifacts.sha((source / "Cargo.lock").read_bytes())
    runner.command(["git", "apply", "--check", str(root / PATCH)], source, env)
    runner.command(["git", "apply", str(root / PATCH)], source, env)
    runner.command(["git", "add", "src/visit.rs"], source, env)
    source_tree = runner.command(["git", "write-tree"], source, env)
    require(source_tree == SOURCE_TREE and lock == LOCK_SHA, "reviewed SDK source or lock differs")
    channel = re.search(r'channel\s*=\s*"([^"]+)"', (root / "rust-toolchain.toml").read_text()).group(1)
    require(channel == "1.94.1", "unreviewed compiler change")
    argv = ["cargo", "+" + channel, "build", "--release", "--locked"]
    with (output.parent / "tool-build.log").open("wb") as log:
        process = runner.OwnedProcess(argv, cwd=source, env=env, log=log)
        try:
            status = process.process.wait(timeout=max(1, runner.COMMAND_DEADLINE - __import__('time').time()))
        finally:
            process.stop(settings["shutdown_seconds"])
    require(status == 0 and artifacts.sha((source / "Cargo.lock").read_bytes()) == lock, "tool build failed or changed lockfile")
    require(not runner.command(["git", "diff", "--name-only"], source, env)
            and runner.command(["git", "write-tree"], source, env) == SOURCE_TREE,
            "SDK source changed during build")
    binary = source / "target/release/cargo-mutants"
    require(0 < binary.stat().st_size <= TOOL_LIMIT, "built tool exceeds transport capacity")
    shutil.copyfile(binary, output / "cargo-mutants")
    executable = output / "cargo-mutants"
    executable.chmod(0o700)
    require(runner.command([str(executable), "mutants", "--version"], root, env) == "cargo-mutants 27.1.0", "built tool version mismatch")
    probe = selector_probe(executable, root, env, output.parent / "selector-probe")
    receipt = {"version": 1, "repository": settings["repository"], "workflow": WORKFLOW,
        "workflow_sha": settings["workflow_sha"], "head_sha": settings["head_sha"],
        "run_id": settings["run_id"], "attempt": settings["attempt"], "job_id": settings["job_id"],
        "checkout": checkout, "contract": contract, "upstream": UPSTREAM, "patch_sha256": PATCH_SHA,
        "log_retention_days": int(os.environ["GITHUB_RETENTION_DAYS"]),
        "source_tree": source_tree, "lock_sha256": lock, "build_argv": argv,
        "build_environment": {key: value for key, value in env.items() if key.startswith("CARGO_PROFILE") or key == "CARGO_BUILD_JOBS"},
        "executable_sha256": artifacts.sha(executable.read_bytes()), "executable_size": executable.stat().st_size,
        "runtime": runtime_identity(executable, root, settings["runner_image"]), "selector_probe": probe}
    runner.write_json(output / "receipt.json", receipt)
    print("MUTATION_TOOL " + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
    return receipt
