"""Pin the workflow's runner budget without adding a YAML dependency.

These are source contracts for the small, literal mappings below, not a YAML
parser. GitHub validates the workflow syntax when it accepts the workflow.
"""

from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "ci.yml"
PIN = Path(__file__).resolve().parents[1] / "runtime" / "pin.json"
MUTATION_JOBS = ("mutation-tool", "mutation-plan", "mutation-native-pilot", "mutation-native-pilot-report",
                 "mutation-admission", "mutation-prepare", "mutants", "mutation-aggregate")
ART_COMMANDS = [
    "python3 -m pip install --quiet --disable-pip-version-check Pillow numpy",
    "python3 -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/sims/sim-01 -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/furniture -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/kitchen -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/kitchen/actions -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/bathroom/actions -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/office -p 'test_*.py'",
    "python3 -B -m unittest discover -s assets/models/outdoor -p 'test_*.py'",
    "python3 assets/sprites/gen/build.py --check",
]


class MutationRunnerBudget(unittest.TestCase):
    def block(self, source, key, indent):
        """Read one uniquely named mapping at the required indentation."""
        lines = source.splitlines()
        header = " " * indent + key + ":"
        starts = [i for i, line in enumerate(lines) if line == header]
        self.assertEqual(len(starts), 1, f"expected one {header!r}")
        body = []
        for line in lines[starts[0] + 1:]:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if len(line) - len(line.lstrip()) <= indent:
                break
            body.append(line)
        return "\n".join(body)

    def setUp(self):
        self.workflow = WORKFLOW.read_text(encoding="utf-8")
        self.jobs = self.block(self.workflow, "jobs", 0)
        self.mutants = self.block(self.jobs, "mutants", 2)

    def test_mutation_slots_are_shared_across_prs_and_keep_pending_jobs(self):
        self.assertEqual(
            self.block(self.mutants, "concurrency", 4),
            "      group: ci-mutation-shard-${{ matrix.shard }}\n"
            "      cancel-in-progress: false\n"
            "      queue: max",
        )

    def test_all_eight_shards_fit_the_shared_budget(self):
        strategy = self.block(self.mutants, "strategy", 4)
        self.assertEqual(
            self.block(strategy, "matrix", 6),
            "        shard: [0, 1, 2, 3, 4, 5, 6, 7]",
        )
        self.assertIn('mutation_workflow.py slot --scope "$MUTATION_SCOPE" --slot "$MUTATION_SLOT"', self.mutants)
        self.assertNotIn("--shard", self.mutants)
        self.assertNotIn("|| true", self.mutants)

    def test_preparation_releases_global_slot_zero_before_workers(self):
        for key in ("mutation-tool", "mutation-plan", "mutation-native-pilot", "mutation-prepare"):
            job = self.block(self.jobs, key, 2)
            self.assertEqual(self.block(job, "concurrency", 4),
                "      group: ci-mutation-shard-0\n      cancel-in-progress: false\n      queue: max")
            self.assertIn("    runs-on: ubuntu-24.04", job)
            self.assertIn("    timeout-minutes: 120", job)
        plan = self.block(self.jobs, "mutation-plan", 2)
        self.assertIn("    needs: [changes, ci-guards, mutation-tool]", plan)
        self.assertIn("    needs: [mutation-plan, mutation-admission]", self.block(self.jobs, "mutation-prepare", 2))
        self.assertIn("    needs: mutation-prepare", self.mutants)
        self.assertIn("    timeout-minutes: 120", self.mutants)
        self.assertEqual(self.workflow.count("group: ci-mutation-shard-"), 6)

    def test_aggregate_runs_after_failed_workers_and_has_distinct_fixture_check(self):
        job = self.block(self.jobs, "mutation-aggregate", 2)
        self.assertIn("    needs: [mutation-plan, mutation-admission, mutation-prepare, mutants]", job)
        self.assertIn("      always() && !cancelled() && needs.mutation-plan.result == 'success'", job)
        self.assertIn("'mutation-fixture-aggregate' || 'mutation-production-aggregate'", job)
        self.assertIn("mutation-fixture-qualification-run-", job)
        self.assertIn("if: always() && steps.execute.outputs.artifact_name != ''", self.mutants)

    def test_native_admission_stops_fanout_and_keeps_review_outside_slot_zero(self):
        pilot = self.block(self.jobs, "mutation-native-pilot", 2)
        report = self.block(self.jobs, "mutation-native-pilot-report", 2)
        admission = self.block(self.jobs, "mutation-admission", 2)
        self.assertIn("    needs: mutation-plan", pilot)
        self.assertIn("    needs: [mutation-plan, mutation-native-pilot]", report)
        self.assertIn("    needs: [mutation-plan, mutation-native-pilot-report]", admission)
        for job in (report, admission):
            self.assertNotIn("    concurrency:", job)
            self.assertNotIn("cargo test", job)
        for key in ("mutation-prepare", "mutation-aggregate"):
            job = self.block(self.jobs, key, 2)
            self.assertIn("needs.mutation-admission.result == 'success'", job)
            self.assertIn("NATIVE_ADMISSION_ARTIFACT_ID:", job)
        self.assertIn("steps.execute.outputs.bundle_ready == 'true'", self.mutants)

    def test_only_read_permissions_no_self_dispatch_no_worker_install(self):
        self.assertEqual(self.block(self.workflow, "permissions", 0), "  contents: read\n  actions: read\n  packages: read")
        publisher = self.block(self.jobs, "runtime-publish", 2)
        self.assertEqual(self.block(publisher, "permissions", 4),
                         "      contents: read\n      actions: read\n      packages: write")
        self.assertEqual(self.workflow.count(": write"), 1)
        self.assertNotIn("gh workflow run", self.workflow)
        self.assertNotIn("cargo install cargo-mutants", self.workflow)
        self.assertNotIn("continue-on-error", self.mutants)
        self.assertIn("MUTATION_ARTIFACT_ID=$ARTIFACT_ID", self.mutants)

    def test_pr_cancellation_is_scoped_and_manual_runs_do_not_hold_push_ci(self):
        self.assertEqual(
            self.block(self.workflow, "concurrency", 0),
            "  group: ci-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}\n"
            "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        )

    def test_complete_workflow_guards_run_independently_of_classification(self):
        changes = self.block(self.jobs, "changes", 2)
        guards = self.block(self.jobs, "ci-guards", 2)
        self.assertIn(
            "        working-directory: .github/scripts\n"
            "        run: python3 -B -m unittest discover -p 'test_*.py'",
            guards,
        )
        self.assertNotIn("    needs:", guards)
        self.assertNotIn("    if:", guards)
        self.assertNotIn("continue-on-error", guards)
        self.assertIn("        run: python3 -B -m unittest test_changes.py", changes)
        self.assertEqual(self.workflow.count("python3 -B -m unittest discover -p 'test_*.py'"), 1)
        self.assertNotIn("unittest discover", changes)

    def test_mutation_tool_and_plan_require_successful_complete_guards(self):
        tool = self.block(self.jobs, "mutation-tool", 2)
        plan = self.block(self.jobs, "mutation-plan", 2)
        self.assertIn("    needs: [changes, ci-guards]", tool)
        self.assertIn("    needs: [changes, ci-guards, mutation-tool]", plan)
        for job in (tool, plan):
            self.assertIn("needs.ci-guards.result == 'success'", job)

    def test_art_retains_every_command_and_runs_alongside_native_and_web(self):
        art = self.block(self.jobs, "art", 2)
        commands = [line.strip() for line in art.splitlines() if line.strip().startswith("python3 ")]
        self.assertEqual(commands, ART_COMMANDS)
        self.assertIn("      - name: Sprite atlas is reproducible", art)
        self.assertIn("      - uses: actions/checkout@v4", art)
        for key in ("rust", "web", "art"):
            job = self.block(self.jobs, key, 2)
            self.assertIn("    needs: changes\n", job + "\n")
            self.assertIn("inputs.runtime_publish != true && needs.changes.outputs.code == 'true' && inputs.mutation_mode != 'fixture'", job)
            self.assertNotIn("continue-on-error", job)
        self.assertNotIn("assets/sprites/gen", self.block(self.jobs, "rust", 2))
        for command in ART_COMMANDS:
            self.assertEqual(self.workflow.count(command), 1, command)

    def test_tested_package_receipt_and_upload_follow_successful_web_tests(self):
        web = self.block(self.jobs, "web", 2)
        receipt = ('python3 -B .github/scripts/pages_artifact.py record --directory web/src/wasm '
                   '--sha "$GITHUB_SHA" --repository "$GITHUB_REPOSITORY" '
                   '--run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT"')
        expected = (
            "      - name: Test\n"
            "        working-directory: web\n"
            "        run: npm test\n"
            "      - name: Record the tested WASM package\n"
            f"        run: {receipt}\n"
            "      - name: Upload the tested WASM package\n"
            "        uses: actions/upload-artifact@v4\n"
            "        with:\n"
            "          name: tested-wasm-${{ github.sha }}-attempt-${{ github.run_attempt }}\n"
            "          path: web/src/wasm\n"
            "          if-no-files-found: error\n"
            "          retention-days: 7"
        )
        self.assertIn(expected, web)
        self.assertNotIn("continue-on-error", web)
        self.assertNotIn("overwrite:", web)

    def test_runtime_publication_is_owner_dispatched_for_one_exact_revision(self):
        dispatch = self.block(self.workflow, "workflow_dispatch", 2)
        self.assertIn("      runtime_publish:\n        description: Publish the mutation runtime image only\n        type: boolean\n        default: false", dispatch)
        self.assertIn("      runtime_build_sha:\n        description: Exact source revision to publish\n        type: string", dispatch)
        publisher = self.block(self.jobs, "runtime-publish", 2)
        self.assertIn("    needs: [changes, ci-guards]", publisher)
        self.assertIn("      github.event_name == 'workflow_dispatch' && inputs.runtime_publish == true &&", publisher)
        self.assertIn("      github.actor == github.repository_owner && inputs.runtime_build_sha == github.sha &&", publisher)
        self.assertIn("      needs.changes.result == 'success' && needs.ci-guards.result == 'success'", publisher)
        self.assertIn("    runs-on: ubuntu-24.04\n    timeout-minutes: 120", publisher)
        self.assertEqual(self.block(publisher, "concurrency", 4),
                         "      group: ci-mutation-shard-0\n      cancel-in-progress: false\n      queue: max")
        self.assertNotIn("continue-on-error", publisher)
        self.assertNotIn("    container:", publisher)

    def test_runtime_publisher_checks_revision_before_build_and_limits_credentials(self):
        publisher = self.block(self.jobs, "runtime-publish", 2)
        self.assertIn("          RUNTIME_BUILD_SHA: ${{ inputs.runtime_build_sha }}", publisher)
        self.assertIn('          [[ "$RUNTIME_BUILD_SHA" =~ ^[0-9a-f]{40}$ ]]', publisher)
        self.assertIn('          [ "$RUNTIME_BUILD_SHA" = "$GITHUB_SHA" ]', publisher)
        self.assertIn("          set -eu", publisher)
        validation, build_and_publish = publisher.split("      - name: Build the mutation runtime image\n")
        self.assertIn('[ "$RUNTIME_BUILD_SHA" = "$GITHUB_SHA" ]', validation)
        build, publish = build_and_publish.split("      - name: Publish the mutation runtime image\n")
        command = ('python3 -B .github/scripts/mutation_runtime_image.py {} '
                   '--tag "ghcr.io/thisnameissoclever/terrilives-mutation-runtime:source-$GITHUB_SHA" '
                   '--output "$RUNNER_TEMP/mutation-runtime-build"')
        self.assertIn("        run: " + command.format("build"), build)
        self.assertNotIn("GH_TOKEN", build)
        self.assertNotIn("TOKEN", validation)
        self.assertIn("        run: " + command.format("publish"), publish)
        self.assertIn("          GH_TOKEN: ${{ github.token }}", publish)
        self.assertEqual(publisher.count("${{ github.token }}"), 1)
        self.assertNotIn("if:", build_and_publish)

    def test_runtime_bootstrap_suppresses_only_ordinary_jobs(self):
        ordinary = ("docs", "changelog", "art", "rust", "web", "mutation-tool", "mutation-plan",
                    "mutation-native-pilot", "mutation-native-pilot-report", "mutation-admission",
                    "mutation-prepare", "mutants", "mutation-aggregate")
        for key in ordinary:
            job = self.block(self.jobs, key, 2)
            self.assertIn("inputs.runtime_publish != true &&", job, key)
        for key in ("changes", "ci-guards"):
            self.assertFalse(any(line.startswith("    if:") for line in self.block(self.jobs, key, 2).splitlines()))

    def test_mutation_jobs_use_the_committed_immutable_runtime(self):
        pin = json.loads(PIN.read_text())
        self.assertRegex(pin["image"], r"^ghcr\.io/thisnameissoclever/terrilives-mutation-runtime@sha256:[0-9a-f]{64}$")
        self.assertRegex(pin["inventory_sha256"], r"^[0-9a-f]{64}$")
        self.assertNotEqual(pin["inventory_sha256"], "0" * 64)
        environment = self.block(self.workflow, "env", 0)
        self.assertEqual(environment, "  MUTATION_RUNTIME_IMAGE: &mutation-runtime-image " + pin["image"])
        self.assertEqual(len(re.findall(r"^\s+MUTATION_RUNTIME_IMAGE:", self.workflow, re.MULTILINE)), 1)
        self.assertEqual(set(pin["recipe_files"]), {".github/runtime/Dockerfile", ".github/runtime/.dockerignore",
                         ".github/runtime/inputs.lock.json", ".github/runtime/inventory.py"})
        for name, expected in pin["recipe_files"].items():
            self.assertEqual(hashlib.sha256((PIN.parents[2] / name).read_bytes()).hexdigest(), expected, name)
        for key in MUTATION_JOBS:
            job = self.block(self.jobs, key, 2)
            self.assertEqual(self.block(job, "container", 4),
                "      image: *mutation-runtime-image\n"
                "      credentials:\n"
                "        username: ${{ github.actor }}\n"
                "        password: ${{ github.token }}\n"
                "      options: --cpus 2 --memory 6g", key)
        self.assertEqual(self.workflow.count("image: *mutation-runtime-image"), len(MUTATION_JOBS))

    def test_mutation_consumers_verify_runtime_without_updating_or_mounting_tools(self):
        self.assertEqual(self.block(self.block(self.workflow, "defaults", 0), "run", 2), "    shell: bash")
        for key in MUTATION_JOBS:
            job = self.block(self.jobs, key, 2)
            self.assertIn("      - name: Verify the pinned mutation runtime\n"
                          "        run: python3 -B .github/scripts/mutation_runtime.py verify --root .", job)
            self.assertNotRegex(job, r"rustup|apt(?:-get)?\s|pip\s+install|cargo\s+install|volumes:|--volume|--mount|--read-only|--user|--tmpfs")
            self.assertNotIn("    permissions:", job)
            self.assertNotIn("    defaults:", job)
        self.assertEqual(self.workflow.count("mutation_runtime.py verify --root ."), len(MUTATION_JOBS))
        for key in ("rust", "web"):
            self.assertIn("        run: rustup show", self.block(self.jobs, key, 2))

    def test_isolated_workflow_guard_removals_are_detected(self):
        controls = [
            ("needs.mutation-admission.result == 'success'", "true",
             "test_native_admission_stops_fanout_and_keeps_review_outside_slot_zero"),
            ("group: ci-mutation-shard-${{ matrix.shard }}", "group: ci-mutation-shard-${{ matrix.shard }}-${{ github.run_id }}",
             "test_mutation_slots_are_shared_across_prs_and_keep_pending_jobs"),
            ("shard: [0, 1, 2, 3, 4, 5, 6, 7]", "shard: [0, 1, 2, 3, 4, 5, 6]", "test_all_eight_shards_fit_the_shared_budget"),
            ("always() && !cancelled() && needs.mutation-plan.result == 'success'",
             "success() && !cancelled() && needs.mutation-plan.result == 'success'",
             "test_aggregate_runs_after_failed_workers_and_has_distinct_fixture_check"),
            ("  actions: read", "  actions: write", "test_only_read_permissions_no_self_dispatch_no_worker_install"),
            ("    needs: [changes, ci-guards]", "    needs: changes",
             "test_mutation_tool_and_plan_require_successful_complete_guards"),
            ("    needs: [changes, ci-guards, mutation-tool]", "    needs: [changes, mutation-tool]",
             "test_mutation_tool_and_plan_require_successful_complete_guards"),
            ("needs.ci-guards.result == 'success' && github.event_name", "github.event_name",
             "test_mutation_tool_and_plan_require_successful_complete_guards"),
            ("      needs.ci-guards.result == 'success' &&", "      true &&",
             "test_mutation_tool_and_plan_require_successful_complete_guards"),
            ("unittest discover -p 'test_*.py'", "unittest test_changes.py",
             "test_complete_workflow_guards_run_independently_of_classification"),
            ("        run: npm test\n      - name: Record the tested WASM package",
             "        run: npm test\n        if: always()\n      - name: Record the tested WASM package",
             "test_tested_package_receipt_and_upload_follow_successful_web_tests"),
            ("          path: web/src/wasm", "          path: web/src/wasm/*.wasm",
             "test_tested_package_receipt_and_upload_follow_successful_web_tests"),
            ("          name: tested-wasm-${{ github.sha }}-attempt-${{ github.run_attempt }}",
             "          name: tested-wasm-${{ github.sha }}",
             "test_tested_package_receipt_and_upload_follow_successful_web_tests"),
            ("          retention-days: 7", "          retention-days: 7\n          overwrite: true",
             "test_tested_package_receipt_and_upload_follow_successful_web_tests"),
            ("          retention-days: 7", "          retention-days: 1",
             "test_tested_package_receipt_and_upload_follow_successful_web_tests"),
            ("github.actor == github.repository_owner", "true",
             "test_runtime_publication_is_owner_dispatched_for_one_exact_revision"),
            ("inputs.runtime_build_sha == github.sha", "true",
             "test_runtime_publication_is_owner_dispatched_for_one_exact_revision"),
            ("github.event_name == 'workflow_dispatch' && inputs.runtime_publish == true", "true",
             "test_runtime_publication_is_owner_dispatched_for_one_exact_revision"),
            ('          [ "$RUNTIME_BUILD_SHA" = "$GITHUB_SHA" ]', "          true",
             "test_runtime_publisher_checks_revision_before_build_and_limits_credentials"),
            ('          [[ "$RUNTIME_BUILD_SHA" =~ ^[0-9a-f]{40}$ ]]', "          true",
             "test_runtime_publisher_checks_revision_before_build_and_limits_credentials"),
            ("inputs.runtime_publish != true && needs.changes.outputs.site", "needs.changes.outputs.site",
             "test_runtime_bootstrap_suppresses_only_ordinary_jobs"),
            ("    shell: bash", "    shell: sh",
             "test_mutation_consumers_verify_runtime_without_updating_or_mounting_tools"),
            ("      options: --cpus 2 --memory 6g", "      options: --cpus 8 --memory 16g",
             "test_mutation_jobs_use_the_committed_immutable_runtime"),
            ("        password: ${{ github.token }}", "        password: unbound",
             "test_mutation_jobs_use_the_committed_immutable_runtime"),
            ("mutation_runtime.py verify --root .", "mutation_runtime.py verify --root . && rustup update",
             "test_mutation_consumers_verify_runtime_without_updating_or_mounting_tools"),
            ("  packages: read", "  packages: write",
             "test_only_read_permissions_no_self_dispatch_no_worker_install"),
            ("      options: --cpus 2 --memory 6g", "      options: --cpus 2 --memory 6g\n      volumes: [/opt/rust:/opt/rust]",
             "test_mutation_consumers_verify_runtime_without_updating_or_mounting_tools")]
        for key in MUTATION_JOBS:
            prefix = self.workflow.split(f"  {key}:\n", 1)[1].split("      image: *mutation-runtime-image", 1)[0]
            old = f"  {key}:\n" + prefix + "      image: *mutation-runtime-image"
            controls.append((old, old.replace("image: *mutation-runtime-image", "image: ubuntu:24.04"),
                             "test_mutation_jobs_use_the_committed_immutable_runtime"))
        pin = json.loads(PIN.read_text())
        controls.append(("&mutation-runtime-image " + pin["image"], "&mutation-runtime-image " + pin["image"][:-1] + ("0" if pin["image"][-1] != "0" else "1"),
                         "test_mutation_jobs_use_the_committed_immutable_runtime"))
        controls.extend((command, "true", "test_art_retains_every_command_and_runs_alongside_native_and_web")
                        for command in ART_COMMANDS)
        controls.extend((f"  {key}:\n    needs: changes", f"  {key}:\n    needs: [changes, ci-guards]",
                         "test_art_retains_every_command_and_runs_alongside_native_and_web")
                        for key in ("rust", "web", "art"))
        receipt_step = ('      - name: Record the tested WASM package\n'
                        '        run: python3 -B .github/scripts/pages_artifact.py record --directory web/src/wasm '
                        '--sha "$GITHUB_SHA" --repository "$GITHUB_REPOSITORY" '
                        '--run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT"\n')
        test_step = "      - name: Test\n        working-directory: web\n        run: npm test\n"
        controls.append((test_step + receipt_step, receipt_step + test_step,
                         "test_tested_package_receipt_and_upload_follow_successful_web_tests"))
        original = WORKFLOW.read_bytes()
        for old, new, test in controls:
            with self.subTest(test=test), tempfile.TemporaryDirectory() as temporary:
                changed = self.workflow.replace(old, new)
                self.assertTrue(changed != self.workflow, f"control did not change {old!r}")
                destination = Path(temporary) / "ci.yml"
                destination.write_text(changed, encoding="utf-8")
                script = ("import sys,unittest,pathlib;sys.path.insert(0," + repr(str(Path(__file__).parent)) + ");"
                    "import test_workflow_concurrency as t;t.WORKFLOW=pathlib.Path(" + repr(str(destination)) + ");"
                    "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(" +
                    repr("test_workflow_concurrency.MutationRunnerBudget." + test) + "));"
                    "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(WORKFLOW.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
