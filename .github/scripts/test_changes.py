"""Tests for changes.py, run by the CI `changes` job before it decides."""

import os
import subprocess
import tempfile
import unittest

import changes


class ClassifyPaths(unittest.TestCase):
    def test_markdown_outside_the_skill_folders_is_documentation(self):
        for path in ("docs/FEATURES.md", "README.md", "assets/models/bathroom/README.md", "docs/specs/x.MD"):
            self.assertTrue(changes.is_documentation(path), path)

    def test_skill_files_are_read_by_tests_so_they_are_not(self):
        for path in (".agents/skills/cloud-run/SKILL.md", ".claude/skills/cloud-run/SKILL.md"):
            self.assertFalse(changes.is_documentation(path), path)

    def test_anything_that_is_not_markdown_is_not(self):
        for path in ("docs/mutants-baseline.txt", "content/tuning.toml", "web/src/main.ts", "check-doc-ids.py", ".github/workflows/ci.yml"):
            self.assertFalse(changes.is_documentation(path), path)

    def test_only_documentation_skips_the_game_checks(self):
        self.assertFalse(changes.affects_game(["docs/FEATURES.md", "README.md"]))
        self.assertTrue(changes.affects_game(["docs/FEATURES.md", "web/src/main.ts"]))
        self.assertTrue(changes.affects_game(["docs/FEATURES.md", ".claude/skills/a/SKILL.md"]))

    def test_an_empty_change_runs_the_checks(self):
        self.assertTrue(changes.affects_game([]))


class DecideFromGit(unittest.TestCase):
    """Against a throwaway repository, so the git diff ranges are real."""

    def setUp(self):
        self.previous = os.getcwd()
        self.folder = tempfile.TemporaryDirectory()
        os.chdir(self.folder.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.base = self.commit({"README.md": "one", "web/main.ts": "one"})

    def tearDown(self):
        os.chdir(self.previous)
        self.folder.cleanup()

    def git(self, *args):
        return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, files):
        for path, text in files.items():
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")
        return self.git("rev-parse", "HEAD")

    def test_a_documentation_push_skips_and_a_code_push_does_not(self):
        docs = self.commit({"README.md": "two"})
        self.assertFalse(changes.decide("push", self.base, docs))
        code = self.commit({"web/main.ts": "two"})
        self.assertTrue(changes.decide("push", docs, code))
        self.assertTrue(changes.decide("push", self.base, code), "any code commit in the push counts")

    def test_a_pull_request_is_compared_from_where_it_branched(self):
        self.git("checkout", "-q", "-b", "feature")
        head = self.commit({"README.md": "two"})
        self.git("checkout", "-q", "main")
        moved_on = self.commit({"web/main.ts": "two"})
        self.assertFalse(changes.decide("pull_request", moved_on, head), "main's own code change is not the pull request's")

    def test_a_rename_into_documentation_counts_both_ends(self):
        self.git("mv", "web/main.ts", "web/main.md")
        self.git("commit", "-q", "-m", "rename")
        self.assertTrue(changes.decide("push", self.base, self.git("rev-parse", "HEAD")))

    def test_unknown_or_missing_history_runs_the_checks(self):
        head = self.commit({"README.md": "two"})
        self.assertTrue(changes.decide("workflow_dispatch", self.base, head))
        self.assertTrue(changes.decide("push", "0" * 40, head))
        # Were the empty-base rule missing, git would read an empty base as
        # the checkout. Check out somewhere else first, so that the range git
        # would then compare is documentation only and cannot pass by luck.
        self.git("checkout", "-q", self.base)
        self.assertTrue(changes.decide("push", "", head))
        self.assertTrue(changes.decide("push", "f" * 40, head), "a base git does not have")


    def test_deleting_documentation_is_documentation(self):
        os.remove("README.md")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "delete")
        self.assertFalse(changes.decide("compare", self.base, self.git("rev-parse", "HEAD")))

    def test_the_answer_is_written_where_the_workflow_reads_it(self):
        docs = self.commit({"README.md": "two"})
        output = os.path.join(self.folder.name, "output.txt")
        previous = os.environ.get("GITHUB_OUTPUT")
        os.environ["GITHUB_OUTPUT"] = output
        try:
            changes.main(["push", self.base, docs])
            code = self.commit({"web/main.ts": "two"})
            changes.main(["push", docs, code])
        finally:
            if previous is None:
                del os.environ["GITHUB_OUTPUT"]
            else:
                os.environ["GITHUB_OUTPUT"] = previous
        with open(output, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "code=false\ncode=true\n")


if __name__ == "__main__":
    unittest.main()
