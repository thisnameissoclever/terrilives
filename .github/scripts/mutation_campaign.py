"""Pure cargo-mutants 27.1.0 campaign rules. No process, filesystem or network I/O.

Artifact authentication belongs to the caller. A payload's provenance fields and
hashes cannot establish that GitHub actually produced or retained an artifact.
All functions return JSON-compatible values and raise ValueError on invalid input.
"""

import copy
import hashlib
import json
import math
import re
from collections import Counter

SCHEMA_VERSION = 1
SLOT_COUNT = 8
TOOL_VERSION = "27.1.0"
IDENTITY_KEYS = {"name", "package", "file", "function", "span", "replacement", "genre"}
DIGEST_KEYS = {"source_digest", "test_digest", "config_digest", "lock_digest",
               "workflow_digest", "runner_digest", "survivor_baseline_digest"}
COUNTERS = {"caught": "CaughtMutant", "missed": "MissedMutant", "timeout": "Timeout",
            "unviable": "Unviable", "success": "Success"}
__all__ = ["build_manifest", "validate_manifest", "slot_ids", "validate_selection",
           "validate_report", "merge_deltas", "summarize", "admit_work", "digest",
           "normalize_survivor"]


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    """SHA-256 of canonical JSON; rejects non-JSON values and nonfinite numbers."""
    try:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("value is not canonical JSON") from error
    return hashlib.sha256(encoded).hexdigest()


def _text(value, label):
    _require(isinstance(value, str) and bool(value.strip()) and "\x00" not in value, label)
    return value


def _integer(value, label, minimum=0):
    _require(type(value) is int and value >= minimum, label)
    return value


def _seconds(value, label):
    _require(type(value) in (int, float) and math.isfinite(value) and value >= 0, label)
    return value


def _hex(value, length, label):
    _require(isinstance(value, str) and re.fullmatch(f"[0-9a-f]{{{length}}}", value), label)
    return value


def _path(value):
    _text(value, "missing relative path")
    _require(not value.startswith("/") and "\\" not in value and ":" not in value
             and all(part not in ("", ".", "..") for part in value.split("/")),
             "unsafe relative path")
    return value


def _span(value):
    _require(isinstance(value, dict) and set(value) == {"start", "end"}, "invalid span")
    coordinates = []
    for endpoint in ("start", "end"):
        point = value[endpoint]
        _require(isinstance(point, dict) and set(point) == {"line", "column"}, "invalid position")
        coordinates.append(tuple(_integer(point[key], "invalid source coordinate", 1)
                                 for key in ("line", "column")))
    _require(coordinates[0] < coordinates[1], "source span must have positive extent")
    return copy.deepcopy(value)


def _identity(value, with_diff=False):
    required = IDENTITY_KEYS | ({"diff"} if with_diff else set())
    _require(isinstance(value, dict) and set(value) == required, "invalid mutation schema")
    for key in ("name", "package", "genre"):
        _text(value[key], f"invalid mutation {key}")
    _require(isinstance(value["replacement"], str) and "\x00" not in value["replacement"], "invalid replacement")
    _require(value["genre"] in {"FnValue", "BinaryOperator", "UnaryOperator", "MatchArm", "MatchArmGuard", "StructField"},
             "unknown mutation genre")
    _path(value["file"])
    span = _span(value["span"])
    start = span["start"]
    _require(value["name"].startswith(f'{value["file"]}:{start["line"]}:{start["column"]}: '),
             "mutation name and source position disagree")
    function = value["function"]
    if function is not None:
        _require(isinstance(function, dict) and set(function) == {"function_name", "return_type", "span"},
                 "invalid function schema")
        _text(function["function_name"], "invalid function name")
        _require(isinstance(function["return_type"], str), "invalid return type")
        _span(function["span"])
        point = lambda p: (p["line"], p["column"])
        _require(point(function["span"]["start"]) <= point(span["start"])
                 and point(span["end"]) <= point(function["span"]["end"]),
                 "mutation outside its function span")
    result = {key: copy.deepcopy(value[key]) for key in IDENTITY_KEYS}
    if with_diff:
        _text(value["diff"], "missing mutation diff")
        result["diff_digest"] = hashlib.sha256(value["diff"].encode("utf-8")).hexdigest()
    return result


def _checkout(value):
    _require(isinstance(value, dict), "missing actual checkout metadata")
    for key in ("repository", "ref"):
        _text(value.get(key), f"invalid checkout {key}")
    for key in ("commit", "tree"):
        _hex(value.get(key), 40, f"invalid checkout {key}")
    _require(value.get("clean") is True, "campaign requires a clean checkout")


def _command(argv, phase, packages):
    """Remove only cargo location and harmless package selectors with workspace."""
    _require(isinstance(argv, list) and len(argv) >= 3
             and all(isinstance(arg, str) and arg for arg in argv), "invalid Cargo argv")
    _require(argv[0].replace("\\", "/").rsplit("/", 1)[-1] in {"cargo", "cargo.exe"}
             and argv[1] == "test", "expected cargo test")
    result = ["cargo", "test"]
    index = 2
    while index < len(argv):
        arg = argv[index]
        if arg in {"--package", "-p"} or arg.startswith("--package="):
            if arg in {"--package", "-p"}:
                index += 1
                _require(index < len(argv), "package option needs a value")
                package = argv[index]
            else:
                package = arg.split("=", 1)[1]
            _require(package.split("@", 1)[0] in packages, "foreign Cargo package selector")
        elif arg in {"--workspace", "--verbose", "-v", "--no-run", "--all-features", "--no-default-features"}:
            result.append(arg)
        elif arg in {"--profile", "--target", "--features"}:
            index += 1
            _require(index < len(argv) and not argv[index].startswith("-"), "Cargo option needs a value")
            result.extend([arg, argv[index]])
        elif any(arg.startswith(option + "=") for option in ("--profile", "--target", "--features")):
            option, argument = arg.split("=", 1)
            _text(argument, "Cargo option needs a value")
            result.extend([option, argument])
        else:
            raise ValueError(f"unsupported Cargo argument: {arg}")
        index += 1
    _require(result.count("--workspace") == 1, "Cargo command must select the complete workspace once")
    _require(result.count("--no-run") == (1 if phase == "Build" else 0), "invalid build/test phase selection")
    for option in ("--profile", "--target", "--features", "--all-features", "--no-default-features"):
        _require(result.count(option) <= 1, "duplicate Cargo option")
    return result


def _context(value, packages):
    _require(isinstance(value, dict) and set(value) == {"inputs", "checkout", "run"}, "invalid context schema")
    _checkout(value["checkout"])
    run = value["run"]
    _require(isinstance(run, dict), "invalid run metadata")
    for key in ("run_id", "workflow"):
        _text(run.get(key), f"invalid run {key}")
    inputs = value["inputs"]
    required = DIGEST_KEYS | {"toolchain", "cargo_mutants_version", "generation_argv", "build_argv",
                              "test_argv", "profile", "target", "features", "environment",
                              "timeout_policy", "scope_version"}
    _require(isinstance(inputs, dict) and required <= set(inputs), "incomplete execution fingerprint")
    for key in DIGEST_KEYS:
        _hex(inputs[key], 64, f"invalid {key}")
    _require(inputs["cargo_mutants_version"] == TOOL_VERSION, "unsupported cargo-mutants version")
    _require(isinstance(inputs["toolchain"], dict), "missing toolchain versions")
    for key in ("rustc", "cargo"):
        _text(inputs["toolchain"].get(key), "missing verbose toolchain version")
    _integer(inputs["scope_version"], "invalid input scope version", 1)
    _require(isinstance(inputs["generation_argv"], list) and inputs["generation_argv"]
             and all(isinstance(arg, str) and arg for arg in inputs["generation_argv"]), "invalid generation argv")
    _require(isinstance(inputs["features"], list)
             and all(isinstance(feature, str) and feature for feature in inputs["features"])
             and len(set(inputs["features"])) == len(inputs["features"]), "invalid features")
    _text(inputs["profile"], "missing approved profile")
    if inputs["target"] is not None:
        _text(inputs["target"], "invalid target")
    _require(isinstance(inputs["environment"], dict), "invalid environment fingerprint")
    for key in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR"):
        _require(inputs["environment"].get(key) is None, f"{key} must be unset")
    policy = inputs["timeout_policy"]
    _require(isinstance(policy, dict) and {"build_seconds", "test_seconds"} <= set(policy), "invalid timeout policy")
    for key in ("build_seconds", "test_seconds"):
        _require(_seconds(policy[key], "invalid timeout cap") > 0, "timeout cap must be positive")
    build = _command(inputs["build_argv"], "Build", packages)
    test = _command(inputs["test_argv"], "Test", packages)
    _require([arg for arg in build if arg != "--no-run"] == test, "baseline build/test contracts differ")
    for option, expected in (("--profile", inputs["profile"]), ("--target", inputs["target"])):
        actual = test[test.index(option) + 1] if option in test else ("test" if option == "--profile" else None)
        _require(actual == expected, f"{option} differs from execution context")
    actual_features = test[test.index("--features") + 1].split(",") if "--features" in test else []
    _require(actual_features == inputs["features"], "features differ from execution context")
    digest(value)


def build_manifest(listing, context):
    """Freeze a complete listing into one canonical manifest and eight fixed slots."""
    _require(isinstance(listing, list) and listing, "empty or malformed mutation inventory")
    mutations = [_identity(item, with_diff=True) for item in listing]
    _require(len({item["name"] for item in mutations}) == len(mutations), "duplicate mutation names")
    composites = [{key: item[key] for key in ("package", "file", "span", "replacement", "genre")}
                  for item in mutations]
    _require(len({digest(item) for item in composites}) == len(mutations), "duplicate mutation identities")
    _context(context, {item["package"] for item in mutations})
    mutations.sort(key=lambda item: (item["package"], item["file"], item["span"]["start"]["line"],
                                    item["span"]["start"]["column"], item["name"]))
    input_fingerprint = digest({"schema_version": SCHEMA_VERSION, "inputs": context["inputs"]})
    campaign_id = digest({"schema_version": SCHEMA_VERSION, "slot_count": SLOT_COUNT,
                          "input_fingerprint": input_fingerprint, "mutations": mutations})
    for index, item in enumerate(mutations):
        item["id"] = digest({"campaign_id": campaign_id, "mutation": item})
        item["slot"] = index % SLOT_COUNT
    return {"schema_version": SCHEMA_VERSION, "slot_count": SLOT_COUNT,
            "campaign_id": campaign_id, "input_fingerprint": input_fingerprint,
            "context": copy.deepcopy(context), "mutations": mutations}


def validate_manifest(manifest):
    """Reject changed inventory, hashes, execution context or slot assignments."""
    _require(isinstance(manifest, dict) and manifest.get("schema_version") == SCHEMA_VERSION
             and manifest.get("slot_count") == SLOT_COUNT, "unsupported manifest schema")
    mutations = manifest.get("mutations")
    _require(isinstance(mutations, list) and mutations, "missing manifest inventory")
    original = []
    for item in mutations:
        _require(isinstance(item, dict) and set(item) == IDENTITY_KEYS | {"diff_digest", "id", "slot"},
                 "invalid canonical mutation schema")
        identity = _identity({key: item[key] for key in IDENTITY_KEYS})
        _hex(item["diff_digest"], 64, "invalid diff digest")
        identity["diff_digest"] = item["diff_digest"]
        original.append(identity)
    _require(len({item["name"] for item in original}) == len(original), "duplicate manifest names")
    _require(len({digest({key: item[key] for key in ("package", "file", "span", "replacement", "genre")})
                  for item in original}) == len(original), "duplicate manifest identities")
    expected_order = sorted(original, key=lambda item: (item["package"], item["file"],
        item["span"]["start"]["line"], item["span"]["start"]["column"], item["name"]))
    _require(original == expected_order, "manifest inventory is not canonical")
    _context(manifest.get("context"), {item["package"] for item in original})
    fingerprint = digest({"schema_version": SCHEMA_VERSION, "inputs": manifest["context"]["inputs"]})
    campaign_id = digest({"schema_version": SCHEMA_VERSION, "slot_count": SLOT_COUNT,
                         "input_fingerprint": fingerprint, "mutations": original})
    _require(manifest.get("input_fingerprint") == fingerprint and manifest.get("campaign_id") == campaign_id,
             "manifest fingerprint mismatch")
    for index, (item, identity) in enumerate(zip(mutations, original)):
        _require(item["id"] == digest({"campaign_id": campaign_id, "mutation": identity})
                 and type(item["slot"]) is int and item["slot"] == index % SLOT_COUNT,
                 "manifest identity or slot mismatch")
    return manifest


def _slot(slot):
    _require(type(slot) is int and 0 <= slot < SLOT_COUNT, "invalid runner slot")


def slot_ids(manifest, slot):
    validate_manifest(manifest)
    _slot(slot)
    return [item["id"] for item in manifest["mutations"] if item["slot"] == slot]


def _batch(manifest, slot, batch_ids, validated=False):
    if not validated:
        validate_manifest(manifest)
    _slot(slot)
    assigned = {item["id"] for item in manifest["mutations"] if item["slot"] == slot}
    _require(isinstance(batch_ids, list) and batch_ids and all(isinstance(mid, str) for mid in batch_ids),
             "batch must contain mutation identities")
    _require(len(set(batch_ids)) == len(batch_ids) and set(batch_ids) <= assigned,
             "duplicate, foreign or wrong-slot batch identities")
    return {item["id"]: item for item in manifest["mutations"] if item["id"] in batch_ids}


def validate_selection(manifest, slot, selected_listing, batch_ids):
    """Prove the tool's preflight listing exactly matches the selected batch."""
    expected = _batch(manifest, slot, batch_ids)
    _require(isinstance(selected_listing, list), "invalid selected listing")
    actual = [_identity(item, with_diff=True) for item in selected_listing]
    canonical_expected = [{key: value for key, value in item.items() if key not in {"id", "slot"}}
                          for item in expected.values()]
    _require(sorted(map(digest, actual)) == sorted(map(digest, canonical_expected)),
             "tool selection differs from requested batch")
    return list(batch_ids)


def _reference(value):
    _require(isinstance(value, dict) and {"path", "digest", "content_digest"} <= set(value), "missing raw report reference")
    _path(value["path"])
    _hex(value["digest"], 64, "invalid raw report digest")
    _hex(value["content_digest"], 64, "invalid parsed report content digest")


def _provenance(manifest, value):
    _require(isinstance(value, dict), "missing caller-supplied provenance")
    for key in ("repository", "workflow", "run_id", "batch_id", "execution_id"):
        _text(value.get(key), f"invalid provenance {key}")
    _integer(value.get("attempt"), "invalid run attempt", 1)
    _checkout(value.get("checkout"))
    _require(value.get("input_fingerprint") == manifest["input_fingerprint"], "foreign input fingerprint")
    _require(value["repository"] == manifest["context"]["checkout"]["repository"]
             == value["checkout"]["repository"]
             and value["workflow"] == manifest["context"]["run"]["workflow"], "foreign repository or workflow")
    digest(value)


def _status(value):
    if isinstance(value, str) and value in {"Success", "Timeout"}:
        return value
    if isinstance(value, dict) and set(value) == {"Failure"}:
        _integer(value["Failure"], "invalid process failure code", 1)
        return "Failure"
    raise ValueError("unknown or interrupted process status")


def _outcome(manifest, value, baseline=False, packages=None):
    _require(isinstance(value, dict) and {"scenario", "summary", "log_path", "diff_path", "phase_results"} <= set(value),
             "invalid raw outcome schema")
    _path(value["log_path"])
    _require((baseline and value["diff_path"] is None) or (not baseline and isinstance(value["diff_path"], str)),
             "invalid scenario diff reference")
    if not baseline:
        _path(value["diff_path"])
    phases = value["phase_results"]
    _require(isinstance(phases, list) and 1 <= len(phases) <= 2, "invalid completed phase sequence")
    statuses = []
    if packages is None:
        packages = {item["package"] for item in manifest["mutations"]}
    inputs = manifest["context"]["inputs"]
    for index, phase in enumerate(phases):
        kind = ("Build", "Test")[index]
        _require(isinstance(phase, dict) and {"phase", "duration", "process_status", "argv"} <= set(phase)
                 and phase["phase"] == kind, "invalid phase ordering")
        _seconds(phase["duration"], "invalid phase duration")
        statuses.append(_status(phase["process_status"]))
        _require(_command(phase["argv"], kind, packages)
                 == _command(inputs["build_argv" if kind == "Build" else "test_argv"], kind, packages),
                 "phase command differs from approved complete workspace command")
    valid = {("Success", "Success"): "Success" if baseline else "MissedMutant",
             ("Success", "Failure"): "CaughtMutant", ("Failure",): "Unviable",
             ("Timeout",): "Timeout", ("Success", "Timeout"): "Timeout"}
    _require(tuple(statuses) in valid and value["summary"] == valid[tuple(statuses)],
             "summary contradicts phase results")
    if baseline:
        _require(value["scenario"] == "Baseline" and value["summary"] == "Success", "baseline did not succeed")
    else:
        _require(isinstance(value["scenario"], dict) and set(value["scenario"]) == {"Mutant"}, "invalid mutant scenario")
        _identity(value["scenario"]["Mutant"])
    return copy.deepcopy(value)


def validate_report(manifest, slot, batch_ids, report, *, provenance, raw_report_ref, exit_kind):
    """Validate raw evidence and return one immutable delta, retaining partial progress.

    exit_kind is caller-observed 'completed', 'interrupted' or 'tool_failure'.
    Only tool-written completed phases count; scheduler interruption adds no result.
    For a controlled stop, the caller must snapshot the report BEFORE any termination
    signal and ignore all post-signal outcomes, since killed tests can look caught.
    The caller must authenticate artifact metadata and bind provenance to its actual
    checkout, execution and input fingerprint before calling this function.
    """
    expected = _batch(manifest, slot, batch_ids)
    _provenance(manifest, provenance)
    _reference(raw_report_ref)
    _require(exit_kind in {"completed", "interrupted", "tool_failure"}, "unknown invocation exit kind")
    _require(exit_kind != "tool_failure", "tool failure supplies no terminal evidence")
    _require(isinstance(report, dict) and report.get("cargo_mutants_version") == TOOL_VERSION,
             "invalid raw report version")
    _require(raw_report_ref["content_digest"] == digest(report), "parsed report content digest mismatch")
    _text(report.get("start_time"), "missing report start time")
    if report.get("end_time") is not None:
        _text(report["end_time"], "invalid report end time")
    _require(exit_kind != "completed" or report.get("end_time") is not None, "completed invocation lacks end time")
    outcomes = report.get("outcomes")
    _require(isinstance(outcomes, list) and outcomes, "missing raw outcomes")
    packages = {item["package"] for item in manifest["mutations"]}
    baseline = _outcome(manifest, outcomes[0], baseline=True, packages=packages)
    baseline_evidence = {"outcome": baseline, "raw_report_ref": copy.deepcopy(raw_report_ref),
                         "provenance": copy.deepcopy(provenance)}
    baseline_evidence["baseline_id"] = digest(baseline_evidence)
    by_name = {item["name"]: item for item in expected.values()}
    records = []
    seen = set()
    counters = dict.fromkeys(COUNTERS, 0)
    for raw in outcomes[1:]:
        checked = _outcome(manifest, raw, packages=packages)
        identity = checked["scenario"]["Mutant"]
        item = by_name.get(identity["name"])
        _require(item is not None and identity == {key: item[key] for key in IDENTITY_KEYS},
                 "unexpected or foreign report mutation")
        _require(item["id"] not in seen, "duplicate report mutation")
        seen.add(item["id"])
        for counter, summary in COUNTERS.items():
            if checked["summary"] == summary:
                counters[counter] += 1
        record = {"schema_version": SCHEMA_VERSION, "campaign_id": manifest["campaign_id"],
                  "mutation_id": item["id"], "slot": slot, "provenance": copy.deepcopy(provenance),
                  "raw_report_ref": copy.deepcopy(raw_report_ref), "baseline": copy.deepcopy(baseline_evidence),
                  "outcome": checked}
        record["record_id"] = digest(record)
        records.append(record)
    _integer(report.get("total_mutants"), "invalid total_mutants")
    _require(report["total_mutants"] == len(records), "completed mutation count disagrees with scenarios")
    for counter, count in counters.items():
        _integer(report.get(counter), f"invalid {counter} counter")
        _require(report[counter] == count, f"{counter} counter disagrees with completed scenarios")
    _require(exit_kind != "completed" or seen == set(expected), "completed report omits selected mutations")
    delta = {"schema_version": SCHEMA_VERSION, "campaign_id": manifest["campaign_id"],
             "slot": slot, "provenance": copy.deepcopy(provenance), "batch_ids": list(batch_ids),
             "raw_report_ref": copy.deepcopy(raw_report_ref), "baseline": baseline_evidence,
             "records": records, "exit_kind": exit_kind}
    delta["delta_id"] = digest(delta)
    return delta


def _baseline(manifest, baseline, provenance, reference, packages):
    _require(isinstance(baseline, dict) and baseline.get("baseline_id") == digest({key: value for key, value in baseline.items()
             if key != "baseline_id"}), "invalid baseline evidence digest")
    _outcome(manifest, baseline.get("outcome"), baseline=True, packages=packages)
    _require(baseline.get("raw_report_ref") == reference
             and baseline.get("provenance") == provenance, "baseline belongs to a different execution")


def _record(manifest, record, by_id=None, packages=None):
    _require(isinstance(record, dict) and record.get("schema_version") == SCHEMA_VERSION
             and record.get("campaign_id") == manifest["campaign_id"], "foreign terminal record")
    _require(record.get("record_id") == digest({key: value for key, value in record.items() if key != "record_id"}),
             "terminal record digest mismatch")
    _provenance(manifest, record.get("provenance"))
    _reference(record.get("raw_report_ref"))
    if by_id is None:
        by_id = {item["id"]: item for item in manifest["mutations"]}
    item = by_id.get(record.get("mutation_id"))
    _require(item is not None and type(record.get("slot")) is int and record["slot"] == item["slot"],
             "foreign mutation or wrong slot")
    checked = _outcome(manifest, record.get("outcome"), packages=packages)
    _require(checked["scenario"]["Mutant"] == {key: item[key] for key in IDENTITY_KEYS}, "record mutation mismatch")
    _baseline(manifest, record.get("baseline"), record["provenance"], record["raw_report_ref"], packages)
    return record


def merge_deltas(manifest, deltas, *, allowed_run_ids, current_run_id, current_attempt, include_current=False):
    """Merge authenticated, caller-selected immutable artifacts.

    allowed_run_ids is the caller-validated predecessor chain plus this run. This
    function does not discover/authenticate that chain or artifact API provenance.
    Resuming rejects current-attempt artifacts; aggregation opts into them.
    """
    validate_manifest(manifest)
    _integer(current_attempt, "invalid current attempt", 1)
    _text(current_run_id, "invalid current run ID")
    _require(type(include_current) is bool and current_run_id in allowed_run_ids, "invalid provenance boundary")
    _require(isinstance(deltas, list), "invalid delta collection")
    records = {}
    by_id = {item["id"]: item for item in manifest["mutations"]}
    packages = {item["package"] for item in manifest["mutations"]}
    seen_deltas = set()
    for delta in deltas:
        _require(isinstance(delta, dict) and delta.get("schema_version") == SCHEMA_VERSION
                 and delta.get("campaign_id") == manifest["campaign_id"], "foreign campaign delta")
        _require(delta.get("delta_id") == digest({key: value for key, value in delta.items() if key != "delta_id"}),
                 "delta digest mismatch")
        _provenance(manifest, delta.get("provenance"))
        provenance = delta["provenance"]
        _require(provenance["run_id"] in allowed_run_ids, "artifact outside validated run chain")
        if provenance["run_id"] == current_run_id:
            _require(provenance["attempt"] <= current_attempt if include_current else provenance["attempt"] < current_attempt,
                     "future or current-attempt resume artifact")
        batch = _batch(manifest, delta.get("slot"), delta.get("batch_ids"), validated=True)
        _reference(delta.get("raw_report_ref"))
        _baseline(manifest, delta.get("baseline"), provenance, delta["raw_report_ref"], packages)
        _require(isinstance(delta.get("records"), list), "invalid terminal record list")
        _require(delta.get("exit_kind") in {"completed", "interrupted"}, "invalid delta exit kind")
        delta_records = set()
        for record in delta["records"]:
            _record(manifest, record, by_id=by_id, packages=packages)
            mutation_id = record["mutation_id"]
            _require(mutation_id in batch and mutation_id not in delta_records, "unexpected or duplicate delta mutation")
            _require(record["slot"] == delta["slot"] and record["provenance"] == provenance
                     and record["raw_report_ref"] == delta["raw_report_ref"]
                     and record["baseline"] == delta.get("baseline"), "record provenance differs from delta")
            delta_records.add(mutation_id)
            if mutation_id in records:
                _require(records[mutation_id] == record, "conflicting or independently executed duplicate result")
            records[mutation_id] = copy.deepcopy(record)
        _require(delta["exit_kind"] != "completed" or delta_records == set(batch), "incomplete completed delta")
        if delta["delta_id"] in seen_deltas:
            continue
        seen_deltas.add(delta["delta_id"])
    return [records[mid] for mid in sorted(records)]


def normalize_survivor(name):
    """Preserve the former sed address normalization, for policy comparison only."""
    return re.sub(r":[0-9]*:[0-9]*:", ":", _text(name, "invalid survivor name"), count=1)


def summarize(manifest, records, accepted_survivors=(), slot=None):
    """Count survivor allowances across all supplied records, then project to slot.

    Allocate one allowance per matching miss in canonical manifest order. Pass the
    complete merged record collection for authoritative cross-slot policy results;
    a partial collection cannot establish how later misses consume allowances.
    """
    validate_manifest(manifest)
    if slot is not None:
        _slot(slot)
    _require(isinstance(records, list), "invalid terminal records")
    planned = {item["id"] for item in manifest["mutations"] if slot is None or item["slot"] == slot}
    accepted = Counter(normalize_survivor(name) for name in accepted_survivors)
    completed, failing, unviable = set(), set(), set()
    validated_records = {}
    by_id = {item["id"]: item for item in manifest["mutations"]}
    packages = {item["package"] for item in manifest["mutations"]}
    for record in records:
        _record(manifest, record, by_id=by_id, packages=packages)
        mid = record["mutation_id"]
        _require(mid not in validated_records, "duplicate terminal result in summary")
        validated_records[mid] = record
    for item in manifest["mutations"]:
        mid = item["id"]
        if mid not in validated_records:
            continue
        record = validated_records[mid]
        summary = record["outcome"]["summary"]
        is_failure = summary == "Timeout"
        if summary == "MissedMutant":
            name = normalize_survivor(item["name"])
            if accepted[name] > 0:
                accepted[name] -= 1
            else:
                is_failure = True
        if mid not in planned:
            continue
        completed.add(mid)
        if is_failure:
            failing.add(mid)
        if summary == "Unviable":
            unviable.add(mid)
    complete = completed == planned
    return {"planned": sorted(planned), "completed": sorted(completed),
            "remaining": sorted(planned - completed), "failing": sorted(failing),
            "unviable": sorted(unviable), "complete": complete,
            "policy_passed": complete and not failing}


def admit_work(window_seconds, *, elapsed_seconds, baseline_seconds, build_cap_seconds,
               test_cap_seconds, shutdown_seconds, upload_seconds, baseline_required=True):
    """Reserve worst-case work before admission. A stop decision is never an outcome.

    baseline_required=False is permitted only after the caller validates a successful
    full baseline from this same attempt and execution context.
    """
    _require(type(baseline_required) is bool, "invalid baseline requirement")
    values = {"window": window_seconds, "elapsed": elapsed_seconds, "baseline": baseline_seconds,
              "build": build_cap_seconds, "test": test_cap_seconds,
              "shutdown": shutdown_seconds, "upload": upload_seconds}
    for key, value in values.items():
        _seconds(value, f"invalid {key} budget")
    _require(all(values[key] > 0 for key in ("window", "baseline", "build", "test", "shutdown", "upload")),
             "work and cleanup reserves must be positive")
    required = (baseline_seconds if baseline_required else 0) + build_cap_seconds + test_cap_seconds + shutdown_seconds + upload_seconds
    _require(required <= window_seconds, "work caps and cleanup cannot fit the finite window")
    remaining = max(0, window_seconds - elapsed_seconds)
    admitted = required <= remaining
    return {"admit": admitted, "reason": "admitted" if admitted else "insufficient_window",
            "required_seconds": required, "remaining_seconds": remaining,
            "baseline_reserved_seconds": baseline_seconds if baseline_required else 0,
            "cleanup_reserved_seconds": shutdown_seconds + upload_seconds}
