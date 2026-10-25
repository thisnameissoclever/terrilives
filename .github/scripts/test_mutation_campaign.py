"""Small cargo-mutants 27.1.0 fixtures, derived from retained CI reports."""

import copy
import hashlib
import json
import unittest
from pathlib import Path

import mutation_campaign as campaign


def inventory(count=10):
    result = []
    for index in range(count):
        line = 14 + index
        result.append({
            "name": f"crates/terri-core/src/appearance.rs:{line}:9: replace F32Bits::value -> f32 with 0.0",
            "package": "terri-core", "file": "crates/terri-core/src/appearance.rs",
            "function": {"function_name": "F32Bits::value", "return_type": "-> f32",
                         "span": {"start": {"line": line - 1, "column": 5},
                                  "end": {"line": line + 1, "column": 6}}},
            "span": {"start": {"line": line, "column": 9},
                     "end": {"line": line, "column": 31}},
            "replacement": "0.0", "genre": "FnValue", "diff": f"-original\n+0.0 {index}\n",
        })
    return result


def context():
    inputs = {key: "a" * 64 for key in (
        "source_digest", "test_digest", "config_digest", "lock_digest",
        "workflow_digest", "runner_digest", "survivor_baseline_digest")}
    inputs.update(toolchain={"rustc": "rustc 1.94.1", "cargo": "cargo 1.94.1"},
                  cargo_mutants_version="27.1.0", generation_argv=["cargo", "mutants", "--list", "--json"],
                  build_argv=["cargo", "test", "--no-run", "--verbose", "--workspace"],
                  test_argv=["cargo", "test", "--verbose", "--workspace"],
                  profile="test", target=None, features=[], environment={},
                  timeout_policy={"build_seconds": 600, "test_seconds": 120}, scope_version=1)
    return {"inputs": inputs,
            "checkout": {"repository": "owner/repo", "commit": "b" * 40,
                         "tree": "c" * 40, "ref": "refs/heads/repair", "clean": True},
            "run": {"run_id": "100", "workflow": ".github/workflows/ci.yml"}}


def phase(kind, status="Success"):
    argv = ["/home/runner/.rustup/toolchains/1.94.1/bin/cargo", "test"]
    if kind == "Build":
        argv.append("--no-run")
    return {"phase": kind, "duration": 1.25, "process_status": status,
            "argv": argv + ["--verbose", "--workspace"]}


def outcome(item=None, summary="CaughtMutant"):
    if item is None:
        summary = "Success"
    phases = [phase("Build"), phase("Test")]
    if summary == "CaughtMutant":
        phases[1]["process_status"] = {"Failure": 101}
    elif summary == "Timeout":
        phases[1]["process_status"] = "Timeout"
    elif summary == "Unviable":
        phases = [phase("Build", {"Failure": 101})]
    return {"scenario": "Baseline" if item is None else {
        "Mutant": {key: copy.deepcopy(value) for key, value in item.items() if key != "diff"}},
        "summary": "Success" if item is None else summary,
        "log_path": "log/baseline.log" if item is None else "log/mutant.log",
        "diff_path": None if item is None else "diff/mutant.diff", "phase_results": phases}


def raw_report(items, summaries=None, interrupted=False):
    summaries = summaries or ["CaughtMutant"] * len(items)
    results = [outcome()] + [outcome(item, summary) for item, summary in zip(items, summaries)]
    counters = {"caught": "CaughtMutant", "missed": "MissedMutant", "timeout": "Timeout",
                "unviable": "Unviable", "success": "Success"}
    return {"outcomes": results, "total_mutants": len(items),
            **{key: summaries.count(value) for key, value in counters.items()},
            "cargo_mutants_version": "27.1.0", "start_time": "2026-10-19T02:49:30Z",
            "end_time": None if interrupted else "2026-10-19T02:50:30Z"}


def report_ref(report, path="raw.json"):
    raw = json.dumps(report, indent=2).encode("utf-8")
    return {"path": path, "digest": hashlib.sha256(raw).hexdigest(),
            "content_digest": campaign.digest(report)}


class CampaignTest(unittest.TestCase):
    def setUp(self):
        self.items = inventory(17)
        self.manifest = campaign.build_manifest(self.items, context())

    def batch(self, slot=0):
        ids = campaign.slot_ids(self.manifest, slot)
        by_name = {item["name"]: item for item in self.items}
        selected = [by_name[item["name"]] for item in self.manifest["mutations"] if item["id"] in ids]
        return ids, selected

    def delta(self, slot=0, attempt=1, items=None, summaries=None, interrupted=False, execution="exec-1", run_id="100"):
        ids, selected = self.batch(slot)
        selected = selected if items is None else items
        provenance = {"repository": "owner/repo", "workflow": ".github/workflows/ci.yml",
                      "run_id": run_id, "attempt": attempt, "batch_id": f"batch-{slot}",
                      "execution_id": f"{execution}-{slot}", "checkout": context()["checkout"],
                      "input_fingerprint": self.manifest["input_fingerprint"]}
        report = raw_report(selected, summaries, interrupted)
        return campaign.validate_report(self.manifest, slot, ids, report, provenance=provenance,
                                        raw_report_ref=report_ref(report, f"reports/{execution}-{slot}.json"),
                                        exit_kind="interrupted" if interrupted else "completed")

    def merge(self, deltas, attempt=1, include_current=True):
        return campaign.merge_deltas(self.manifest, deltas, allowed_run_ids={"100"},
                                     current_run_id="100", current_attempt=attempt,
                                     include_current=include_current)

    def test_manifest_order_identity_and_exact_eight_slot_partition(self):
        other = campaign.build_manifest(list(reversed(self.items)), context())
        self.assertEqual(self.manifest, other)
        slots = [set(campaign.slot_ids(self.manifest, index)) for index in range(8)]
        self.assertEqual(set.union(*slots), {item["id"] for item in self.manifest["mutations"]})
        self.assertEqual(sum(map(len, slots)), len(self.items))
        self.assertEqual(self.manifest["slot_count"], 8)

    def test_checkout_documentation_commit_is_provenance_not_reuse_identity(self):
        changed = context()
        changed["checkout"]["commit"] = "d" * 40
        changed["checkout"]["tree"] = "e" * 40
        changed["run"]["run_id"] = "101"
        other = campaign.build_manifest(self.items, changed)
        self.assertEqual(self.manifest["campaign_id"], other["campaign_id"])
        self.assertNotEqual(self.manifest["context"], other["context"])

    def test_source_and_test_fingerprints_invalidate_identity(self):
        for key in ("source_digest", "test_digest"):
            changed = context()
            changed["inputs"][key] = "d" * 64
            self.assertNotEqual(self.manifest["campaign_id"],
                                campaign.build_manifest(self.items, changed)["campaign_id"])

    def test_reject_empty_duplicate_malformed_and_invalid_spans(self):
        for listing in ([], [self.items[0], self.items[0]], [{}]):
            with self.subTest(listing=listing), self.assertRaises(ValueError):
                campaign.build_manifest(listing, context())
        for line, column in ((0, 9), (14, 0), (15, 9), (True, 9)):
            bad = copy.deepcopy(self.items[:1])
            bad[0]["span"]["start"] = {"line": line, "column": column}
            with self.subTest(line=line, column=column), self.assertRaises(ValueError):
                campaign.build_manifest(bad, context())

    def test_full_identity_does_not_normalize_addresses(self):
        self.assertEqual(len({item["id"] for item in self.manifest["mutations"]}), len(self.items))
        self.assertEqual(len({campaign.normalize_survivor(item["name"]) for item in self.items}), 1)

    def test_actual_operator_and_deletion_genres_allow_empty_replacement(self):
        for genre in ("BinaryOperator", "UnaryOperator", "MatchArm", "MatchArmGuard", "StructField"):
            item = copy.deepcopy(self.items[:1])
            item[0].update(genre=genre, replacement="")
            with self.subTest(genre=genre):
                manifest = campaign.build_manifest(item, context())
                self.assertEqual(manifest["mutations"][0]["replacement"], "")

    def test_retained_inventory_schema_when_local_evidence_is_available(self):
        retained = Path(__file__).resolve().parents[2] / ".local-build/build-ui-followup/timeout-shard-0/mutants.json"
        if not retained.exists():
            self.skipTest("retained investigation evidence is local and untracked")
        listing = json.loads(retained.read_text(encoding="utf-8"))
        manifest = campaign.build_manifest(listing, context())
        campaign.validate_manifest(manifest)
        self.assertEqual(len(manifest["mutations"]), len(listing))

    def test_forged_record_baseline_or_digest_does_not_become_terminal(self):
        delta = self.delta()
        for alter in (lambda r: r.update(record_id="f" * 64),
                      lambda r: r["baseline"]["outcome"].update(summary="Failure"),
                      lambda r: r["baseline"]["provenance"].update(attempt=999),
                      lambda r: r.update(mutation_id="f" * 64)):
            record = copy.deepcopy(delta["records"][0])
            alter(record)
            with self.assertRaises(ValueError):
                campaign.summarize(self.manifest, [record])

    def test_empty_interrupted_delta_still_requires_valid_baseline(self):
        delta = self.delta(items=[], interrupted=True)
        delta["baseline"]["outcome"]["phase_results"][1]["process_status"] = {"Failure": 101}
        delta["baseline"]["baseline_id"] = campaign.digest({k: v for k, v in delta["baseline"].items() if k != "baseline_id"})
        delta["delta_id"] = campaign.digest({k: v for k, v in delta.items() if k != "delta_id"})
        with self.assertRaises(ValueError):
            self.merge([delta])

    def test_unknown_schema_and_nonfinite_context_are_rejected(self):
        for alter in (lambda c: c["inputs"].update(timeout_policy={"build_seconds": -1, "test_seconds": 1}),
                      lambda c: c["inputs"]["environment"].update(TERRI_WRITE_RUNTIME_FIXTURE="1"),
                      lambda c: c["inputs"].update(profile="release"),
                      lambda c: c["inputs"].update(features=["unexpected"])):
            bad = context()
            alter(bad)
            with self.assertRaises(ValueError):
                campaign.build_manifest(self.items, bad)

    def test_manifest_tampering_and_invalid_context_are_rejected(self):
        bad = copy.deepcopy(self.manifest)
        bad["mutations"][0]["slot"] = 7
        with self.assertRaises(ValueError):
            campaign.validate_manifest(bad)
        for key, value in (("clean", False), ("commit", "unknown")):
            bad_context = context()
            bad_context["checkout"][key] = value
            with self.assertRaises(ValueError):
                campaign.build_manifest(self.items, bad_context)

    def test_selection_rejects_omission_duplicate_foreign_and_wrong_slot(self):
        ids, selected = self.batch()
        campaign.validate_selection(self.manifest, 0, selected, ids)
        for bad in (selected[:-1], selected + selected[:1], selected + [inventory(30)[-1]]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                campaign.validate_selection(self.manifest, 0, bad, ids)
        with self.assertRaises(ValueError):
            campaign.validate_selection(self.manifest, 1, selected, ids)

    def test_complete_campaign_and_zero_work_resumed_slot(self):
        records = self.merge([self.delta(slot=index) for index in range(8)])
        summary = campaign.summarize(self.manifest, records)
        self.assertTrue(summary["complete"])
        self.assertTrue(summary["policy_passed"])
        self.assertEqual(len(summary["completed"]), 17)
        self.assertEqual(summary["remaining"], [])
        self.assertTrue(campaign.summarize(self.manifest, records, slot=0)["complete"])

    def test_interrupted_report_keeps_completed_then_resumes_missing(self):
        ids, selected = self.batch()
        partial = self.delta(items=selected[:1], interrupted=True)
        records = self.merge([partial])
        summary = campaign.summarize(self.manifest, records, slot=0)
        self.assertFalse(summary["complete"])
        self.assertEqual(len(summary["remaining"]), len(ids) - 1)
        later_ids = [item for item in ids if item not in summary["completed"]]
        provenance = copy.deepcopy(partial["provenance"])
        provenance.update(attempt=2, execution_id="resumed")
        report = raw_report(selected[1:])
        resumed = campaign.validate_report(self.manifest, 0, later_ids, report, provenance=provenance,
                    raw_report_ref=report_ref(report, "reports/resumed.json"),
                    exit_kind="completed")
        records = self.merge([partial, resumed], attempt=2)
        self.assertTrue(campaign.summarize(self.manifest, records, slot=0)["complete"])

    def test_one_missing_identity_and_no_evidence_fail_completion(self):
        deltas = [self.delta(slot=index) for index in range(8)]
        records = self.merge(deltas)
        self.assertFalse(campaign.summarize(self.manifest, records[:-1])["complete"])
        self.assertFalse(campaign.summarize(self.manifest, [])["complete"])

    def test_duplicate_artifact_replay_deduplicates_but_new_execution_rejects(self):
        delta = self.delta()
        self.assertEqual(self.merge([delta, copy.deepcopy(delta)]), self.merge([delta]))
        with self.assertRaises(ValueError):
            self.merge([delta, self.delta(execution="independent")])

    def test_contradictory_terminal_result_rejected(self):
        with self.assertRaises(ValueError):
            self.merge([self.delta(), self.delta(summaries=["MissedMutant"] * len(self.batch()[0]))])

    def test_foreign_fingerprint_wrong_slot_future_and_current_resume_rejected(self):
        original = self.delta()
        for mutate in (lambda d: d.update(slot=1),
                       lambda d: d["provenance"].update(input_fingerprint="f" * 64),
                       lambda d: d["provenance"].update(attempt=2),
                       lambda d: d["provenance"].update(run_id="999")):
            bad = copy.deepcopy(original)
            mutate(bad)
            bad["delta_id"] = campaign.digest({k: v for k, v in bad.items() if k != "delta_id"})
            with self.assertRaises(ValueError):
                self.merge([bad])
        with self.assertRaises(ValueError):
            self.merge([original], include_current=False)
        with self.assertRaisesRegex(ValueError, "future"):
            self.merge([self.delta(attempt=2)])
        with self.assertRaisesRegex(ValueError, "run chain"):
            self.merge([self.delta(run_id="999")])

    def test_baseline_evidence_cannot_cross_attempt_or_input_fingerprint(self):
        ids, items = self.batch()
        template = self.delta()
        for key in ("source_digest", "test_digest"):
            provenance = copy.deepcopy(template["provenance"])
            altered_context = context()
            altered_context["inputs"][key] = "f" * 64
            foreign = campaign.build_manifest(self.items, altered_context)
            provenance["input_fingerprint"] = foreign["input_fingerprint"]
            report = raw_report(items)
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "fingerprint"):
                campaign.validate_report(self.manifest, 0, ids, report, provenance=provenance,
                                         raw_report_ref=report_ref(report), exit_kind="completed")
        delta = self.delta()
        record = delta["records"][0]
        record["baseline"]["provenance"]["attempt"] = 2
        baseline = record["baseline"]
        baseline["baseline_id"] = campaign.digest({k: v for k, v in baseline.items() if k != "baseline_id"})
        record["record_id"] = campaign.digest({k: v for k, v in record.items() if k != "record_id"})
        with self.assertRaisesRegex(ValueError, "different execution"):
            campaign.summarize(self.manifest, [record])

    def test_baseline_commands_must_cover_identical_full_workspace(self):
        ids, items = self.batch()
        template = self.delta()
        for extra in (["--lib"], ["one_test_name"], ["--check"], ["--profile", "release"],
                      ["--target", "other"], ["--features", "unexpected"], ["--", "--ignored"]):
            report = raw_report(items)
            report["outcomes"][0]["phase_results"][1]["argv"] += extra
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.validate_raw(ids, report, template)
        report = raw_report(items)
        report["outcomes"][0]["phase_results"][1]["argv"].remove("--workspace")
        with self.assertRaises(ValueError):
            self.validate_raw(ids, report, template)
        report = raw_report(items)
        for entry in report["outcomes"][0]["phase_results"]:
            entry["argv"] += ["--package=terri-core@1.0.0"]
        self.validate_raw(ids, report, template)

    def validate_raw(self, ids, report, template, exit_kind="completed"):
        return campaign.validate_report(self.manifest, 0, ids, report,
                    provenance=template["provenance"], raw_report_ref=report_ref(report), exit_kind=exit_kind)

    def test_raw_byte_and_parsed_content_digests_are_distinct_and_bound(self):
        ids, items = self.batch()
        template = self.delta()
        report = raw_report(items)
        reference = report_ref(report)
        self.assertNotEqual(reference["digest"], reference["content_digest"])
        reference["content_digest"] = "f" * 64
        with self.assertRaises(ValueError):
            campaign.validate_report(self.manifest, 0, ids, report, provenance=template["provenance"],
                                     raw_report_ref=reference, exit_kind="completed")

    def test_bad_baseline_corrupted_status_duration_counters_and_version(self):
        ids, items = self.batch()
        template = self.delta()
        mutations = [
            lambda r: r["outcomes"].pop(0),
            lambda r: r["outcomes"][0].update(summary="Failure"),
            lambda r: r["outcomes"][0]["phase_results"][1].update(process_status={"Failure": 101}),
            lambda r: r["outcomes"][1]["phase_results"][1].update(process_status="Success"),
            lambda r: r["outcomes"][1]["phase_results"][1].update(process_status="Interrupted"),
            lambda r: r["outcomes"][1]["phase_results"][1].update(duration=-1),
            lambda r: r["outcomes"][1]["phase_results"][1].update(duration=float("inf")),
            lambda r: r.update(caught=99), lambda r: r.update(total_mutants=0),
            lambda r: r.update(cargo_mutants_version="28.0.0"),
            lambda r: r["outcomes"].append(copy.deepcopy(r["outcomes"][1])),
            lambda r: r["outcomes"][1]["scenario"]["Mutant"].update(replacement="foreign"),
        ]
        for index, mutate in enumerate(mutations):
            report = raw_report(items)
            mutate(report)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.validate_raw(ids, report, template)

    def test_real_timeout_remains_terminal_failure_interruption_does_not(self):
        ids, items = self.batch()
        template = self.delta()
        timed_out = self.delta(summaries=["Timeout"] * len(items))
        result = campaign.summarize(self.manifest, self.merge([timed_out]), slot=0)
        self.assertTrue(result["complete"])
        self.assertFalse(result["policy_passed"])
        self.assertEqual(set(result["failing"]), set(ids))
        report = raw_report(items)
        with self.assertRaises(ValueError):
            self.validate_raw(ids, report, template, exit_kind="tool_failure")
        report["end_time"] = None
        with self.assertRaises(ValueError):
            self.validate_raw(ids, report, template)

    def test_accepted_survivor_policy_does_not_change_identity_or_excuse_timeout(self):
        ids, items = self.batch()
        missed = self.delta(summaries=["MissedMutant"] * len(items))
        records = self.merge([missed])
        self.assertFalse(campaign.summarize(self.manifest, records, slot=0)["policy_passed"])
        accepted = [item["name"].replace(":14:9:", ":999:1:") for item in items]
        self.assertTrue(campaign.summarize(self.manifest, records, accepted_survivors=accepted, slot=0)["policy_passed"])
        unviable = self.delta(summaries=["Unviable"] * len(items))
        result = campaign.summarize(self.manifest, self.merge([unviable]), slot=0)
        self.assertTrue(result["policy_passed"])
        self.assertEqual(set(result["unviable"]), set(ids))

    def test_survivor_allowances_are_counted_and_allocated_in_manifest_order(self):
        ids, items = self.batch()
        records = self.merge([self.delta(summaries=["MissedMutant"] * len(items))])
        self.assertEqual(len(ids), 3)
        for count in (1, 2, 3):
            accepted = [items[0]["name"]] * count
            result = campaign.summarize(self.manifest, records, accepted_survivors=accepted, slot=0)
            self.assertEqual(set(result["failing"]), set(ids[count:]))
            self.assertEqual(result["policy_passed"], count == 3)
            self.assertEqual(result, campaign.summarize(
                self.manifest, list(reversed(records)), accepted_survivors=accepted, slot=0))
        self.assertEqual(set(result["completed"]), set(ids))

    def test_two_allowances_accept_exactly_two_matching_misses(self):
        self.items = inventory(9)
        self.manifest = campaign.build_manifest(self.items, context())
        ids, items = self.batch()
        self.assertEqual(len(ids), 2)
        records = self.merge([self.delta(summaries=["MissedMutant"] * 2)])
        result = campaign.summarize(self.manifest, records, accepted_survivors=[items[0]["name"]] * 2, slot=0)
        self.assertTrue(result["policy_passed"])
        self.assertEqual(result["failing"], [])

    def test_survivor_allocation_is_global_before_projection_to_slot(self):
        records = self.merge([self.delta(slot=index, summaries=["MissedMutant"] * len(self.batch(index)[0]))
                              for index in range(8)])
        accepted = [self.items[0]["name"]]
        overall = campaign.summarize(self.manifest, records, accepted_survivors=accepted)
        self.assertEqual(len(overall["failing"]), len(self.items) - 1)
        first_id = self.manifest["mutations"][0]["id"]
        self.assertNotIn(first_id, overall["failing"])
        for slot in range(8):
            result = campaign.summarize(self.manifest, list(reversed(records)), accepted_survivors=accepted, slot=slot)
            self.assertEqual(set(result["failing"]), set(overall["failing"]) & set(self.batch(slot)[0]))

    def test_completed_report_omission_with_consistent_counters_is_rejected(self):
        ids, items = self.batch()
        report = raw_report(items[:1])
        self.assertEqual(report["total_mutants"], report["caught"])
        with self.assertRaisesRegex(ValueError, "completed report omits"):
            self.validate_raw(ids, report, self.delta())

    def test_duplicate_report_identity_with_consistent_counters_is_rejected(self):
        ids, items = self.batch()
        report = raw_report(items)
        report["outcomes"].append(copy.deepcopy(report["outcomes"][1]))
        report["total_mutants"] += 1
        report["caught"] += 1
        self.assertEqual(len(report["outcomes"]) - 1, report["total_mutants"])
        with self.assertRaisesRegex(ValueError, "duplicate report mutation"):
            self.validate_raw(ids, report, self.delta())

    def test_approved_build_argv_with_test_phase_label_is_rejected(self):
        ids, items = self.batch()
        report = raw_report(items)
        report["outcomes"][1]["phase_results"][0]["phase"] = "Test"
        with self.assertRaisesRegex(ValueError, "invalid phase ordering"):
            self.validate_raw(ids, report, self.delta())

    def test_valid_mutation_outside_valid_function_span_is_rejected(self):
        listing = inventory(1)
        listing[0]["function"]["span"] = {"start": {"line": 100, "column": 5},
                                              "end": {"line": 102, "column": 6}}
        with self.assertRaisesRegex(ValueError, "outside its function span"):
            campaign.build_manifest(listing, context())

    def test_admission_reserves_all_work_and_rejects_impossible_budgets(self):
        options = dict(elapsed_seconds=0, baseline_seconds=50, build_cap_seconds=20,
                       test_cap_seconds=70, shutdown_seconds=5, upload_seconds=5)
        self.assertTrue(campaign.admit_work(150, **options)["admit"])
        options["elapsed_seconds"] = 1
        decision = campaign.admit_work(150, **options)
        self.assertFalse(decision["admit"])
        self.assertEqual(decision["reason"], "insufficient_window")
        for window in (149, float("inf"), -1):
            with self.subTest(window=window), self.assertRaises(ValueError):
                campaign.admit_work(window, **options)

    def test_locked_option_is_preserved_and_duplicate_missing_or_extra_is_rejected(self):
        listing = inventory(1)
        for declared, actual, valid in ((True, True, True), (True, False, False), (False, True, False)):
            ctx = context()
            if declared:
                ctx["inputs"]["build_argv"].append("--locked")
                ctx["inputs"]["test_argv"].append("--locked")
            manifest = campaign.build_manifest(listing, ctx)
            report = raw_report(listing)
            if actual:
                for result in report["outcomes"]:
                    for step in result["phase_results"]:
                        step["argv"].append("--locked")
            provenance = dict(self.delta()["provenance"], input_fingerprint=manifest["input_fingerprint"])
            def validate():
                return campaign.validate_report(manifest, 0, campaign.slot_ids(manifest, 0), report,
                    provenance=provenance, raw_report_ref=report_ref(report), exit_kind="completed")
            if valid:
                self.assertEqual(validate()["records"][0]["outcome"]["phase_results"][1]["argv"][-1], "--locked")
                report["outcomes"][0]["phase_results"][0]["argv"].append("--locked")
                with self.assertRaisesRegex(ValueError, "duplicate Cargo option"):
                    validate()
            else:
                with self.assertRaisesRegex(ValueError, "command"):
                    validate()
        ctx = context()
        ctx["inputs"]["test_argv"].extend(["--locked", "--locked"])
        with self.assertRaisesRegex(ValueError, "duplicate Cargo option"):
            campaign.build_manifest(listing, ctx)


if __name__ == "__main__":
    unittest.main()
