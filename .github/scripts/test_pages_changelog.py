"""Source contracts for the publication route; GitHub validates YAML syntax."""

from pathlib import Path
import unittest

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"


class ChangelogPublication(unittest.TestCase):
    def setUp(self):
        self.ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.pages = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")

    def test_notes_have_a_ci_job_even_when_game_jobs_skip(self):
        start = self.ci.index("  changelog:\n")
        end = self.ci.index("\n  rust:", start)
        job = self.ci[start:end]
        self.assertIn("if: needs.changes.outputs.site == 'true'", job)
        self.assertIn("node --test scripts/build-changelog.test.mjs", job)
        self.assertIn("node scripts/build-changelog.mjs", job)
        self.assertIn("site: ${{ steps.classify.outputs.site }}", self.ci)
        self.assertIn('"$EVENT" "$BASE" "$HEAD" "$SITE_BASE"', self.ci)
        self.assertIn("SITE_BASE: ${{ github.event.pull_request.base.sha || steps.tested.outputs.site_sha }}", self.ci)

    def test_pages_accepts_tested_notes_and_requires_successful_push_ci(self):
        self.assertIn('select(.name == "web" or .name == "changelog")', self.pages)
        self.assertIn('any(. == "success")', self.pages)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", self.pages)
        self.assertIn("github.event.workflow_run.event == 'push'", self.pages)
        self.assertIn("if: needs.decide.outputs.site == 'true'", self.pages)

    def test_newer_notes_make_older_deployments_stale(self):
        self.assertIn("sed -n 's/^site=//p'", self.pages)
        self.assertIn('if [ "$site" = "false" ]', self.pages)
        self.assertNotIn('if [ "$code" = "false" ]', self.pages)
        self.assertIn("if: steps.release.outputs.current == 'true'", self.pages)

    def test_pages_builds_the_tested_sha_and_checks_the_changelog_artifact(self):
        self.assertEqual(self.pages.count("ref: ${{ github.event.workflow_run.head_sha }}"), 2)
        self.assertIn("test -f web/dist/changelog/index.html", self.pages)
        self.assertIn("path: web/dist", self.pages)


if __name__ == "__main__":
    unittest.main()
