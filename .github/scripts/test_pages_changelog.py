"""Source contracts for the publication route; GitHub validates YAML syntax."""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import re

import changes

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"


class ChangelogPublication(unittest.TestCase):
    def setUp(self):
        self.ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.pages = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")

    def test_direct_main_push_filter_matches_stale_classifier_exactly(self):
        trigger = self.pages[self.pages.index("on:\n"):self.pages.index("\npermissions:")]
        self.assertIn("  push:\n    branches: [main]", trigger)
        self.assertNotIn("workflow_run:", trigger)
        self.assertNotIn("pull_request:", trigger)
        paths = tuple(re.findall(r"^      - '([^']+)'$", trigger, re.MULTILINE))
        self.assertEqual(paths, changes.PAGES_PATHS)
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
        start = self.pages.index('          test "$GITHUB_REPOSITORY"')
        end = self.pages.index('\n  build:', start)
        guard = self.pages[start:end]
        ref_check = guard.index('test "$GITHUB_REF" = "refs/heads/main"')
        sha_check = guard.index('test "$VALIDATED_SHA" = "$GITHUB_SHA"')
        main_check = guard.index('test "$current_sha" = "$VALIDATED_SHA"')
        release = guard.index('echo "site=true"')
        self.assertLess(ref_check, release)
        self.assertLess(sha_check, release)
        self.assertLess(main_check, release)
        self.assertIn('echo "tested_sha=$GITHUB_SHA"', guard)
        self.assertIn("needs: [decide, build]", self.pages)
        self.assertIn("TESTED_SHA: ${{ needs.decide.outputs.tested_sha }}", self.pages)

    def test_automatic_publication_authenticates_event_repository_ref_and_sha(self):
        for guard in ('test "$GITHUB_REPOSITORY" = "thisnameissoclever/terrilives"',
                      'test "$SOURCE_REPOSITORY" = "$GITHUB_REPOSITORY"',
                      'test "$GITHUB_REF" = "refs/heads/main"',
                      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]',
                      'test "$EVENT" = "push"', 'test "$PUSH_SHA" = "$GITHUB_SHA"'):
            self.assertIn(guard, self.pages)

    def test_pages_builds_wasm_once_without_automatic_ci_dependency(self):
        self.assertNotIn("reuse_wasm", self.pages)
        self.assertNotIn("pages_artifact.py", self.pages)
        self.assertNotIn("workflow_run", self.pages)
        build = self.pages[self.pages.index("  build:"):self.pages.index("  deploy:")]
        self.assertEqual(build.count("run: wasm-pack build crates/terri-wasm"), 1)
        for artifact in ("index.html", "changelog/index.html", "guide/index.html", "guide/ui-elements/index.html"):
            self.assertIn("test -f web/dist/" + artifact, build)
        self.assertIn('test -n "$wasm"', build)
        self.assertNotIn("continue-on-error", build)

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
            ('test "$SOURCE_REPOSITORY" = "$GITHUB_REPOSITORY"', ':', "test_automatic_publication_authenticates_event_repository_ref_and_sha"),
            ('test "$PUSH_SHA" = "$GITHUB_SHA"', ':', "test_automatic_publication_authenticates_event_repository_ref_and_sha"),
            ('test "$current_sha" = "$VALIDATED_SHA"', ':', "test_manual_publication_requires_the_exact_main_commit_before_building"),
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

    def decide(self, **environment):
        workflow = (WORKFLOWS / "pages.yml").read_text(encoding="utf-8")
        start = workflow.index("        run: |\n") + len("        run: |\n")
        end = workflow.index("\n  build:", start)
        script = "\n".join(line[10:] for line in workflow[start:end].splitlines())
        script = 'gh() { printf "%s" "$CURRENT_SHA"; }\n' + script
        output = self.root / "decision-output"
        output.write_text("", encoding="utf-8")
        sha = "a" * 40
        env = dict(os.environ, GITHUB_OUTPUT=str(output), VALIDATED_SHA=sha, CURRENT_SHA=sha,
                   GITHUB_SHA=sha, GITHUB_REF="refs/heads/main", GITHUB_REPOSITORY="thisnameissoclever/terrilives",
                   EVENT="push", PUSH_SHA=sha, SOURCE_REPOSITORY="thisnameissoclever/terrilives")
        env.update(environment)
        result = subprocess.run([self.bash, "-c", script], cwd=self.root, env=env,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result, dict(line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines())

    def test_direct_push_publishes_the_exact_event_sha(self):
        result, output = self.decide()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, {"site": "true", "tested_sha": "a" * 40})

    def test_untrusted_event_repository_ref_and_sha_fail_closed(self):
        for environment in ({"EVENT": "pull_request"}, {"GITHUB_REPOSITORY": "outsider/repo"},
                            {"SOURCE_REPOSITORY": "outsider/repo"}, {"PUSH_SHA": "b" * 40},
                            {"GITHUB_SHA": "not-a-sha"}, {"GITHUB_REF": "refs/heads/feature"}):
            with self.subTest(environment=environment):
                result, output = self.decide(**environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotEqual(output.get("site"), "true")

    def test_manual_release_builds_fresh_and_rejects_wrong_sha_or_ref(self):
        result, output = self.decide(EVENT="workflow_dispatch")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, {"site": "true", "tested_sha": "a" * 40})
        for environment in ({"VALIDATED_SHA": "b" * 40}, {"GITHUB_REF": "refs/heads/feature"},
                            {"CURRENT_SHA": "b" * 40}, {"CURRENT_SHA": ""}):
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
        self.commit("README.md", "fixture history")
        self.commit("web/src/main.ts", "tested")
        self.git("symbolic-ref", "HEAD", "refs/heads/main", cwd=self.origin)
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
        for name in ("docs/internal.md", "web/tests/runtime.test.ts", ".github/workflows/ci.yml",
                     "docs/player/changelog/2026-10-22-notes.md", "docs/player/guide.md", "web/src/main.ts"):
            with self.subTest(name=name):
                self.git("checkout", "main")
                self.commit(name, "new content")
                self.git("checkout", "--detach", self.tested)
                result, output = self.release()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([line for line in output.splitlines() if line.startswith("current=")],
                                 ["current=true" if not changes.is_publication_input(name) else "current=false"])
                self.git("checkout", "main")

    def test_sparse_shallow_release_fetch_compares_exact_remote_tip(self):
        original = self.work
        clone = self.root / "release"
        self.git("clone", "--depth=1", "--filter=blob:none", "--no-checkout", self.origin.as_uri(), str(clone), cwd=self.root)
        self.git("sparse-checkout", "init", "--no-cone", cwd=clone)
        self.git("sparse-checkout", "set", "--no-cone", ".github/scripts/changes.py", cwd=clone)
        self.git("checkout", "--detach", self.tested, cwd=clone)
        self.assertFalse((clone / "web/src/main.ts").exists())
        self.assertFalse((clone / ".git/shallow").read_text().strip() == "")
        self.commit("docs/internal.md", "new docs")
        try:
            self.work = clone
            result, output = self.release()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("current=true", output)
            self.work = original
            self.commit("web/src/main.ts", "new published source")
            self.work = clone
            result, output = self.release()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("current=false", output)
        finally:
            self.work = original

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
