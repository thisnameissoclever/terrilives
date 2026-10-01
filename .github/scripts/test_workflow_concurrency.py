"""Pin the workflow's runner budget without adding a YAML dependency.

These are source contracts for the small, literal mappings below, not a YAML
parser. GitHub validates the workflow syntax when it accepts the workflow.
"""

from pathlib import Path
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "ci.yml"


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
        self.assertIn("--shard ${{ matrix.shard }}/8 || true", self.mutants)

    def test_pr_cancellation_is_scoped_and_manual_runs_do_not_hold_push_ci(self):
        self.assertEqual(
            self.block(self.workflow, "concurrency", 0),
            "  group: ci-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}\n"
            "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        )

    def test_classifier_job_runs_the_workflow_guards(self):
        changes = self.block(self.jobs, "changes", 2)
        self.assertIn(
            "        working-directory: .github/scripts\n"
            "        run: python3 -B -m unittest discover -p 'test_*.py'",
            changes,
        )


if __name__ == "__main__":
    unittest.main()
