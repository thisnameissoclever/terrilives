"""List-only qualification of the owner-approved isolated selector repair."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "fixture"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def regex_escape(value):
    return "".join("\\" + char if char in r"\.^$|?*+()[]{}" else char for char in value)


def exact(value):
    return "^" + regex_escape(value) + "$"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", default=shutil.which("cargo-mutants"))
    parser.add_argument("--label", required=True)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, help="Fresh stock listing over this exact frozen source.")
    parser.add_argument("--fixture-only", action="store_true", help="Run selector regressions without enumerating the game.")
    args = parser.parse_args()
    if not args.executable or not re.fullmatch(r"[A-Za-z0-9_-]+", args.label):
        parser.error("An executable and a simple result label are required.")
    executable = Path(args.executable).resolve(strict=True)
    project = args.project_root.resolve(strict=True)
    output = ROOT / "results" / args.label
    output.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ)
    environment["CARGO_NET_OFFLINE"] = "true"
    environment["CARGO_TARGET_DIR"] = str(ROOT / "metadata-target")
    environment["RUSTUP_TOOLCHAIN"] = "1.94.1"
    environment["CARGO_BUILD_JOBS"] = "2"
    for name in ("TEMP", "TMP", "TMPDIR"):
        environment[name] = str(ROOT / "tmp")
    for name in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR"):
        environment.pop(name, None)
    invocations = []

    def invoke(label, arguments, timeout=120):
        started = time.monotonic()
        result = subprocess.run([str(executable), "mutants", *arguments], cwd=ROOT,
                                env=environment, capture_output=True, timeout=timeout)
        (output / f"{label}.stdout.json").write_bytes(result.stdout)
        (output / f"{label}.stderr.log").write_bytes(result.stderr)
        invocations.append({"label": label, "argv": [str(executable), "mutants", *arguments],
                            "wall_seconds": round(time.monotonic() - started, 6), "exit_code": result.returncode,
                            "stdout_sha256": sha256(result.stdout), "stderr_sha256": sha256(result.stderr)})
        write_json(output / "invocations.json", invocations)
        if result.returncode != 0:
            raise RuntimeError(f"Listing infrastructure failed for {label}: exit {result.returncode}")
        return json.loads(result.stdout.decode("utf-8-sig"))

    version = subprocess.run([str(executable), "mutants", "--version"], cwd=ROOT,
                             env=environment, capture_output=True, check=True, timeout=30)
    provenance = {"started_utc": datetime.now(timezone.utc).isoformat(), "executable": str(executable),
                  "executable_sha256": sha256(executable.read_bytes()),
                  "version": version.stdout.decode().strip(), "label": args.label,
                  "only_mutants_listing_commands": True, "candidate_run_authorization": "Owner approved isolated build and listing qualification.",
                  "scoped_rustup_toolchain": environment["RUSTUP_TOOLCHAIN"],
                  "fixture_cargo_version": subprocess.check_output(["cargo", "-V"], cwd=FIXTURE, env=environment).decode().strip(),
                  "fixture_rustc_version": subprocess.check_output(["rustc", "-Vv"], cwd=FIXTURE, env=environment).decode().strip(),
                  "baseline": str(args.baseline.resolve()) if args.baseline else "This fresh stock listing establishes the frozen-source reference.",
                  "fixture_sha256": {str(path.relative_to(FIXTURE)).replace("\\", "/"): sha256(path.read_bytes())
                                       for path in [FIXTURE / "Cargo.toml", FIXTURE / "src/lib.rs", FIXTURE / "rust-toolchain.toml"]}}
    write_json(output / "provenance.json", provenance)
    base = ["--dir", str(FIXTURE), "--list", "--json"]
    full = invoke("unfiltered", [*base, "--no-config"])
    full_names = [entry["name"] for entry in full]
    assert len(full_names) == len(set(full_names))
    fields = [entry for entry in full if entry["genre"] == "StructField"]
    assert len(fields) == 2 and fields[0]["span"]["start"]["line"] == fields[1]["span"]["start"]["line"]
    field_a = next(entry["name"] for entry in fields if "delete field first " in entry["name"])
    field_b = next(entry["name"] for entry in fields if "delete field second " in entry["name"])
    assert field_a != field_b
    ordinary = [entry["name"] for entry in full if entry.get("function", {}).get("function_name") == "ordinary"]
    assert ordinary
    include_a, include_b, ordinary_re = exact(field_a), exact(field_b), "ordinary"
    nothing = "^THIS_NAME_DOES_NOT_EXIST$"
    cases = []

    def case(label, expected, cli=(), include=(), exclude=()):
        arguments = list(base)
        if include or exclude:
            config = output / f"{label}.toml"
            text = ""
            for key, patterns in (("examine_re", include), ("exclude_re", exclude)):
                if patterns:
                    assert all("'" not in pattern for pattern in patterns)
                    text += key + " = [" + ", ".join("'" + pattern + "'" for pattern in patterns) + "]\n"
            config.write_text(text, encoding="utf-8")
            arguments.extend(["--config", str(config)])
        else:
            arguments.append("--no-config")
        actual = invoke(label, [*arguments, *cli])
        actual_names = [entry["name"] for entry in actual]
        expected_names = sorted(expected)
        record = {"case": label, "expected_names": expected_names, "actual_names": actual_names,
                  "missing": list((Counter(expected_names) - Counter(actual_names)).elements()),
                  "unexpected": list((Counter(actual_names) - Counter(expected_names)).elements())}
        try:
            assert sorted(actual_names) == expected_names, f"Expected {expected_names!r}; got {sorted(actual_names)!r}"
        except AssertionError as error:
            record.update({"status": "FAIL", "assertion_error": str(error)})
        else:
            record.update({"status": "PASS", "assertion_error": None})
        cases.append(record)
        print(f"{record['status']} {label}: expected {len(expected_names)}, actual {len(actual_names)}", flush=True)
        return actual_names

    by_case = {}
    by_case["cli_include_nothing"] = case("cli_include_nothing", [], cli=["--re", nothing])
    by_case["config_include_nothing"] = case("config_include_nothing", [], include=[nothing])
    by_case["cli_exact_A"] = case("cli_exact_A", [field_a], cli=["--re", include_a])
    by_case["config_exact_A"] = case("config_exact_A", [field_a], include=[include_a])
    without_a = [name for name in full_names if name != field_a]
    by_case["cli_exclude_A"] = case("cli_exclude_A", without_a, cli=["--exclude-re", include_a])
    by_case["config_exclude_A"] = case("config_exclude_A", without_a, exclude=[include_a])
    by_case["cli_ordinary_only"] = case("cli_ordinary_only", ordinary, cli=["--re", ordinary_re])
    by_case["config_ordinary_only"] = case("config_ordinary_only", ordinary, include=[ordinary_re])
    by_case["cli_OR_A_B"] = case("cli_OR_A_B", [field_a, field_b], cli=["--re", include_a, "--re", include_b])
    by_case["config_OR_A_B"] = case("config_OR_A_B", [field_a, field_b], include=[include_a, include_b])
    by_case["cli_OR_A_ordinary"] = case("cli_OR_A_ordinary", [field_a, *ordinary], cli=["--re", include_a, "--re", ordinary_re])
    by_case["config_OR_A_ordinary"] = case("config_OR_A_ordinary", [field_a, *ordinary], include=[include_a, ordinary_re])
    by_case["mixed_config_A_cli_ordinary"] = case("mixed_config_A_cli_ordinary", [field_a, *ordinary], cli=["--re", ordinary_re], include=[include_a])
    by_case["cli_include_A_exclude_A"] = case("cli_include_A_exclude_A", [], cli=["--re", include_a, "--exclude-re", include_a])
    by_case["mixed_include_A_B_exclude_A"] = case("mixed_include_A_B_exclude_A", [field_b], cli=["--exclude-re", include_a], include=[include_a, include_b])
    by_case["config_include_A_exclude_A"] = case("config_include_A_exclude_A", [], include=[include_a], exclude=[include_a])
    for suffix in ("include_nothing", "exact_A", "exclude_A", "ordinary_only", "OR_A_B", "OR_A_ordinary"):
        left, right = by_case[f"cli_{suffix}"], by_case[f"config_{suffix}"]
        try:
            assert Counter(left) == Counter(right), "CLI and config selected different multisets"
        except AssertionError as error:
            cases.append({"case": f"parity_{suffix}", "status": "FAIL", "assertion_error": str(error)})
        else:
            cases.append({"case": f"parity_{suffix}", "status": "PASS", "assertion_error": None})

    if args.fixture_only:
        summary = {"provenance": provenance, "fixture_unfiltered_count": len(full), "field_names": [field_a, field_b],
                   "same_line_field_span": [entry["span"] for entry in fields], "ordinary_count": len(ordinary),
                   "specification_assertions": len(cases), "specification_passed": sum(case["status"] == "PASS" for case in cases),
                   "specification_failed": sum(case["status"] == "FAIL" for case in cases), "cases": cases}
        write_json(output / "qualification.json", summary)
        write_json(output / "case-results.json", cases)
        print(json.dumps({key: summary[key] for key in ("specification_assertions", "specification_passed", "specification_failed")}))
        return 1 if summary["specification_failed"] else 0

    project_listing = invoke("project-full-unfiltered", ["--dir", str(project), "--list", "--json", "--no-config",
                             "--package", "terri-core", "--package", "terri-sim", "--package", "terri-data", "--package", "terri-wasm"])
    project_names = [entry["name"] for entry in project_listing]
    assert len(project_names) == len(set(project_names))
    if args.baseline is None and args.label != "stock_current":
        raise ValueError("Only stock_current may establish a new frozen-source reference.")
    previous = json.loads(args.baseline.read_text(encoding="utf-8-sig")) if args.baseline else project_listing
    canonical_project = json.dumps(project_listing, sort_keys=True, separators=(",", ":")).encode()
    fixture_field_names = [field_a, field_b]
    summary = {"provenance": provenance, "fixture_unfiltered_count": len(full), "field_names": fixture_field_names,
               "same_line_field_span": [entry["span"] for entry in fields], "ordinary_count": len(ordinary),
               "specification_assertions": len(cases), "specification_passed": sum(case["status"] == "PASS" for case in cases),
               "specification_failed": sum(case["status"] == "FAIL" for case in cases), "cases": cases,
               "project_inventory_count": len(project_listing), "project_inventory_unique_names": len(set(project_names)),
               "project_inventory_ordered_names_match_previous": project_names == [entry["name"] for entry in previous],
               "project_inventory_canonical_entries_match_previous": project_listing == previous,
               "project_inventory_raw_sha256": sha256((output / "project-full-unfiltered.stdout.json").read_bytes()),
               "project_inventory_canonical_sha256": sha256(canonical_project),
               "candidate_qualification_status": "Stock negative control; failures are expected." if args.label == "stock_current" else "Owner-approved candidate listing qualification; no mutation execution."}
    write_json(output / "qualification.json", summary)
    write_json(output / "case-results.json", cases)
    (output / "assertions.txt").write_text("\n".join(f"{case['status']} {case['case']}: {case.get('assertion_error') or 'assertion satisfied'}" for case in cases) + "\n", encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("specification_assertions", "specification_passed", "specification_failed", "project_inventory_count", "project_inventory_raw_sha256", "project_inventory_ordered_names_match_previous")}))
    inventory_preserved = summary["project_inventory_ordered_names_match_previous"] and summary["project_inventory_canonical_entries_match_previous"]
    return 1 if summary["specification_failed"] or not inventory_preserved else 0


if __name__ == "__main__":
    raise SystemExit(main())
