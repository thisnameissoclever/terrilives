"""Source contracts for the publication route; GitHub validates YAML syntax."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
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
        self.assertIn('any(job["status"] == "completed" and job["conclusion"] == "success"', self.pages)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", self.pages)
        self.assertIn("github.event.workflow_run.event == 'push'", self.pages)
        self.assertIn("if: needs.decide.outputs.site == 'true'", self.pages)

    def test_newer_notes_make_older_deployments_stale(self):
        self.assertIn("sed -n 's/^site=//p'", self.pages)
        self.assertIn('if [ "$site" = "false" ]', self.pages)
        self.assertNotIn('if [ "$code" = "false" ]', self.pages)
        self.assertIn("if: steps.release.outputs.current == 'true'", self.pages)

    def test_pages_builds_the_tested_sha_and_checks_the_changelog_artifact(self):
        self.assertEqual(self.pages.count("ref: ${{ needs.decide.outputs.tested_sha }}"), 2)
        self.assertIn("test -f web/dist/changelog/index.html", self.pages)
        self.assertIn("path: web/dist", self.pages)

    def test_manual_publication_requires_the_exact_main_commit_before_building(self):
        self.assertIn("workflow_dispatch:", self.pages)
        start = self.pages.index('if [ "$EVENT" = "workflow_dispatch" ]')
        end = self.pages.index('fi\n', start)
        guard = self.pages[start:end]
        ref_check = guard.index('test "$GITHUB_REF" = "refs/heads/main"')
        sha_check = guard.index('test "$VALIDATED_SHA" = "$GITHUB_SHA"')
        release = guard.index('echo "site=true"')
        self.assertLess(ref_check, release)
        self.assertLess(sha_check, release)
        self.assertIn('echo "tested_sha=$GITHUB_SHA"', guard)
        self.assertIn("needs: [decide, build]", self.pages)
        self.assertIn("TESTED_SHA: ${{ needs.decide.outputs.tested_sha }}", self.pages)

    def test_only_successful_automatic_web_uses_the_exact_run_package(self):
        self.assertIn("reuse_wasm: ${{ steps.content.outputs.reuse_wasm }}", self.pages)
        self.assertIn('echo "reuse_wasm=false"', self.pages)
        self.assertIn('web[0]["status"] == "completed" and web[0]["conclusion"] == "success"', self.pages)
        self.assertIn('test "$producer" = "true"', self.pages)
        for guard in ('.path ==', '.head_sha ==', '.head_branch ==', '.repository.full_name ==', '.head_repository.full_name =='):
            self.assertIn(guard, self.pages)
        self.assertIn('python3 -B .github/scripts/pages_artifact.py restore --directory web/src/wasm', self.pages)
        self.assertIn('--sha "$TESTED_SHA" --repository "$GITHUB_REPOSITORY" --run-id "$RUN"', self.pages)
        build = self.pages[self.pages.index("  build:"):self.pages.index("  deploy:")]
        self.assertEqual(build.count("if: needs.decide.outputs.reuse_wasm != 'true'"), 3)
        self.assertEqual(build.count("if: needs.decide.outputs.reuse_wasm == 'true'"), 1)
        restore = build[build.index("- name: Restore the tested WASM package"):build.index("- name: Install web dependencies")]
        self.assertNotIn("||", restore)
        self.assertNotIn("continue-on-error", restore)

    def test_deploy_fetches_metadata_and_exact_current_sha_only(self):
        build = self.pages[self.pages.index("  build:"):self.pages.index("  deploy:")]
        deploy = self.pages[self.pages.index("  deploy:"):]
        self.assertNotIn("filter:", build)
        self.assertIn("fetch-depth: 1", deploy)
        self.assertIn("filter: blob:none", deploy)
        self.assertIn("sparse-checkout: .github/scripts/changes.py", deploy)
        self.assertIn("sparse-checkout-cone-mode: false", deploy)
        self.assertIn('git fetch --quiet --no-tags --depth=1 --filter=blob:none origin "$current_sha"', deploy)
        self.assertNotIn("fetch-depth: 0", deploy)
        self.assertNotIn("git fetch --quiet origin main", deploy)

    def test_publication_guard_removals_are_detected(self):
        original = self.pages
        for old, new, check in (
            ('test "$producer" = "true"', ':', "test_only_successful_automatic_web_uses_the_exact_run_package"),
            ("if: needs.decide.outputs.reuse_wasm == 'true'", "if: always()", "test_only_successful_automatic_web_uses_the_exact_run_package"),
            ('--sha "$TESTED_SHA" --repository "$GITHUB_REPOSITORY" --run-id "$RUN"', '--sha "$GITHUB_SHA"', "test_only_successful_automatic_web_uses_the_exact_run_package"),
            ('git fetch --quiet --no-tags --depth=1 --filter=blob:none origin "$current_sha"', 'git fetch origin main', "test_deploy_fetches_metadata_and_exact_current_sha_only"),
            ("sparse-checkout-cone-mode: false", "sparse-checkout-cone-mode: true", "test_deploy_fetches_metadata_and_exact_current_sha_only"),
            ('if [ "$site" = "false" ]', 'if [ "$code" = "false" ]', "test_newer_notes_make_older_deployments_stale"),
            ('test "$VALIDATED_SHA" = "$GITHUB_SHA"', ':', "test_manual_publication_requires_the_exact_main_commit_before_building"),
        ):
            with self.subTest(guard=old):
                self.assertIn(old, original)
                self.pages = original.replace(old, new)
                with self.assertRaises((AssertionError, ValueError)):
                    getattr(self, check)()
        self.pages = original


class PublicationDecisionBehavior(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bash = shutil.which("bash")
        if os.name == "nt":
            self.bash = str(Path(shutil.which("git")).parents[1] / "bin/bash.exe")
        if not self.bash or not Path(self.bash).is_file():
            self.skipTest("Bash is needed to execute the publication decision")

    def decide(self, web="success", notes="success", **environment):
        workflow = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")
        start = workflow.index("        run: |\n") + len("        run: |\n")
        end = workflow.index("\n  build:", start)
        script = "\n".join(line[10:] for line in workflow[start:end].splitlines())
        script = (f'python3() {{ "{Path(sys.executable).as_posix()}" "$@"; }}\n'
                  'gh() { if [[ "$*" == *"/jobs?"* ]]; then printf "%s" "$JOBS"; else printf "%s" "$PRODUCER"; fi; }\n' + script)
        output = self.root / "decision-output"
        output.write_text("", encoding="utf-8")
        sha = "a" * 40
        jobs = [{"name": name, "status": "completed", "conclusion": conclusion}
                for name, conclusion in (("web", web), ("changelog", notes))]
        env = dict(os.environ, GITHUB_OUTPUT=str(output), TESTED_SHA=sha, VALIDATED_SHA=sha,
                   GITHUB_SHA=sha, GITHUB_REF="refs/heads/main", GITHUB_REPOSITORY="owner/repo",
                   EVENT="workflow_run", RUN="123", PRODUCER="true", JOBS=json.dumps(jobs))
        env.update(environment)
        result = subprocess.run([self.bash, "-c", script], cwd=self.root, env=env,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result, dict(line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines())

    def test_successful_web_reuses_but_notes_only_builds_fresh(self):
        for web, notes, site, reuse in (("success", "success", "true", "true"),
                                        ("skipped", "success", "true", "false"),
                                        ("skipped", "skipped", "false", "false")):
            with self.subTest(web=web, notes=notes):
                result, output = self.decide(web, notes)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output["site"], site)
                self.assertEqual(output["reuse_wasm"], reuse)

    def test_untrusted_producer_and_contradictory_jobs_fail_closed(self):
        for environment in ({"PRODUCER": "false"}, {"JOBS": "[]"},
                            {"JOBS": '[{"name":"web","status":"in_progress","conclusion":null},{"name":"changelog","status":"completed","conclusion":"success"}]'}):
            with self.subTest(environment=environment):
                result, output = self.decide(**environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotEqual(output.get("site"), "true")

    def test_manual_release_builds_fresh_and_rejects_wrong_sha_or_ref(self):
        result, output = self.decide(EVENT="workflow_dispatch")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output["reuse_wasm"], "false")
        for environment in ({"VALIDATED_SHA": "b" * 40}, {"GITHUB_REF": "refs/heads/feature"}):
            with self.subTest(environment=environment):
                result, output = self.decide(EVENT="workflow_dispatch", **environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotEqual(output.get("site"), "true")


class StalePublicationBehavior(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.origin, self.work = self.root / "origin.git", self.root / "work"
        self.work.mkdir()
        self.git("init", "--bare", str(self.origin), cwd=self.root)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        self.git("remote", "add", "origin", str(self.origin))
        classifier = self.work / ".github/scripts/changes.py"
        classifier.parent.mkdir(parents=True)
        shutil.copyfile(WORKFLOWS.parent / "scripts/changes.py", classifier)
        self.commit("game.txt", "tested")
        self.tested = self.git("rev-parse", "HEAD").strip()
        self.bash = shutil.which("bash")
        if os.name == "nt":
            self.bash = str(Path(shutil.which("git")).parents[1] / "bin/bash.exe")
        if not self.bash or not Path(self.bash).is_file():
            self.skipTest("Bash is needed to execute the production release guard")

    def git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.work, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

    def commit(self, name, text):
        path = self.work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-m", "fixture")
        self.git("push", "origin", "main")

    def release(self, override=""):
        workflow = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")
        start = workflow.index("      - name: Confirm the tested revision is still the main tip")
        start = workflow.index("        run: |\n", start) + len("        run: |\n")
        end = workflow.index("\n      - id: deployment", start)
        script = "\n".join(line[10:] for line in workflow[start:end].splitlines())
        script = f'python3() {{ "{Path(sys.executable).as_posix()}" "$@"; }}\n' + override + script
        output = self.root / "release-output"
        output.write_text("", encoding="utf-8")
        environment = dict(os.environ, TESTED_SHA=self.tested, GITHUB_OUTPUT=str(output))
        result = subprocess.run([self.bash, "-c", script], cwd=self.work, env=environment,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result, output.read_text(encoding="utf-8")

    def test_current_and_unpublished_docs_publish_but_notes_guide_and_code_do_not(self):
        result, output = self.release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "current=true\n")
        for name in ("docs/internal.md", "docs/player/changelog/2026-10-22-notes.md", "docs/player/guide.md", "game.txt"):
            with self.subTest(name=name):
                self.git("checkout", "main")
                self.commit(name, "new content")
                self.git("checkout", "--detach", self.tested)
                result, output = self.release()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([line for line in output.splitlines() if line.startswith("current=")],
                                 ["current=true" if name == "docs/internal.md" else "current=false"])
                self.git("checkout", "main")

    def test_unknown_ref_failed_fetch_and_failed_diff_never_authorize_publication(self):
        self.commit("docs/internal.md", "new docs")
        for override in ('git() { if [ "$1" = "ls-remote" ]; then return 1; fi; command git "$@"; }\n',
                         'git() { if [ "$1" = "fetch" ]; then return 1; fi; command git "$@"; }\n',
                         f'python3() {{ "{Path(sys.executable).as_posix()}" -B .github/scripts/changes.py compare "$TESTED_SHA" missing-revision; }}\n'):
            with self.subTest(override=override):
                result, output = self.release(override)
                self.assertNotIn("current=true", output)

    def test_missing_classification_cannot_authorize_publication(self):
        self.commit("docs/internal.md", "new docs")
        result, output = self.release('python3() { printf "code=false\\n"; }\n')
        self.assertNotIn("current=true", output)


if __name__ == "__main__":
    unittest.main()
