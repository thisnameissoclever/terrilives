"""Tests for changes.py, run by the CI `changes` job before it decides."""

import os
import contextlib
import io
import glob
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock

import changes

ROOT = Path(__file__).resolve().parents[2]


def expand_braces(pattern):
    """Expand Vite's current comma-separated brace alternatives for dependency tests."""
    group = re.search(r"\{([^{}]+)\}", pattern)
    if not group:
        return [pattern]
    return [expanded for option in group[1].split(",")
            for expanded in expand_braces(pattern[:group.start()] + option + pattern[group.end():])]


class SourcePublicationInputs(unittest.TestCase):
    def test_every_literal_external_web_import_and_vite_glob_is_published(self):
        imports, patterns, missing = set(), set(), set()
        for source in (ROOT / "web/src").rglob("*.ts"):
            text = source.read_text(encoding="utf-8")
            for specifier in re.findall(r"(?:\bfrom\s+|^\s*import\s*)['\"](\.[^'\"]+)['\"]", text, re.MULTILINE):
                path = (source.parent / specifier.split("?", 1)[0]).resolve().relative_to(ROOT).as_posix()
                if not path.startswith("web/"):
                    imports.add(path)
            calls = re.findall(r"\bimport\.meta\.glob(?:<[^>]*>)?\(\s*(['\"])(.*?)\1", text)
            self.assertEqual(len(calls), len(re.findall(r"\bimport\.meta\.glob(?:<[^>]*>)?\(", text)),
                             f"Dependency scan must support every Vite glob in {source.relative_to(ROOT)}")
            for _, pattern in calls:
                for expanded in expand_braces(pattern):
                    resolved = (source.parent / expanded).resolve()
                    files = [Path(path) for path in glob.glob(str(resolved), recursive=True) if Path(path).is_file()]
                    self.assertTrue(files, f"No build inputs matched {pattern}")
                    patterns.add(pattern)
                    for file in files:
                        path = file.relative_to(ROOT).as_posix()
                        if not changes.is_publication_input(path):
                            missing.add(path)
        self.assertTrue(imports, "Must inspect actual external imports")
        self.assertTrue(patterns, "Must inspect actual runtime asset globs")
        missing.update(path for path in imports if not changes.is_publication_input(path))
        self.assertEqual(sorted(missing), [], "Production imports or emitted runtime assets cannot skip publication")

    def test_rust_build_helpers_and_compiled_fixture_inputs_are_published(self):
        missing, helpers, fixtures = set(), set(), set()
        helper_source = (ROOT / "crates/terri-data/build_pre_books.rs").read_text(encoding="utf-8")
        names = set(re.findall(r'"([^"/]+\.(?:toml|txt))"', helper_source))
        self.assertTrue(names, "Must inspect actual frozen-pack filenames")
        for source in (ROOT / "crates").glob("*/build.rs"):
            text = source.read_text(encoding="utf-8")
            for module in re.findall(r"\bmod\s+(\w+)\s*;", text):
                helper = source.parent / (module + ".rs")
                if helper.is_file():
                    helpers.add(helper.relative_to(ROOT).as_posix())
            for directory in re.findall(r'workspace\.join\("(crates/[^\"]+)"\)', text):
                folder = ROOT / directory
                self.assertTrue(folder.is_dir(), directory)
                fixtures.update((folder / name).relative_to(ROOT).as_posix()
                                for name in names if (folder / name).is_file())
        self.assertTrue(helpers, "Must inspect actual build helper modules")
        self.assertTrue(fixtures, "Must inspect actual compiled fixture inputs")
        missing.update(path for path in helpers | fixtures if not changes.is_publication_input(path))
        self.assertEqual(sorted(missing), [], "Production build inputs remain deployed inputs regardless of directory name")


class ClassifyPaths(unittest.TestCase):
    def test_actual_game_and_publication_build_inputs_publish(self):
        paths = (".github/workflows/pages.yml", ".github/scripts/changes.py",
                 "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml",
                 "crates/terri-data/Cargo.toml", "crates/terri-data/build.rs",
                 "crates/terri-sim/src/systems/action.rs", "content/objects.toml",
                 "assets/sprites/atlas.toml", "web/src/main.ts", "web/public/audio/talk.wav",
                 "web/index.html", "web/package.json", "web/package-lock.json",
                 "web/vite.config.ts", "web/tsconfig.json", "web/changelog/template.html",
                 "web/guide/plugin.ts", "scripts/build-changelog.mjs", "scripts/build-player-guide.mjs",
                 "scripts/player-markdown.mjs", "scripts/player-coverage.mjs",
                 "scripts/player-illustrations.mjs", "scripts/player-activity-filters.mjs")
        for path in paths:
            self.assertTrue(changes.affects_site([path]), path)

    def test_tests_engineering_docs_and_tooling_do_not_publish(self):
        for path in (".github/workflows/ci.yml", ".github/runtime/pin.json",
                     "web/tests/startup.test.ts", "scripts/build-changelog.test.mjs",
                     "web/src/engine.test.ts", "web/src/nested/engine.spec.ts", "web/src/__tests__/engine.ts",
                     "crates/terri-sim/tests/walking.rs", "crates/terri-sim/examples/trace.rs",
                     "crates/terri-sim/src/test_content.rs", "crates/terri-sim/src/details_tests.rs",
                     "crates/terri-sim/src/placement/tests.rs", "crates/terri-sim/src/placement/tests/moving.rs",
                     "assets/sprites/gen/build.py", "assets/models/chair/source.blend",
                     "assets/models/sims/character-creator/authoring/actor.blend",
                     "assets/models/sims/character-creator/clips/bed/render.py",
                     "assets/models/sims/character-creator/export/source.blend",
                     "assets/models/sims/character-repair/fixture-depth/build.py",
                     "assets/models/sims/character-repair/fixture-depth/review.png",
                     "assets/models/sims/character-repair/unshipped-trial/manifest.json",
                     "crates/terri-data/tests/fixtures/pre-books-920abaf/edited.sav",
                     "crates/terri-data/tests/fixtures/pre-books-edit-845101d/source.json",
                     "docs/testing-protocol.md", "docs/mutants-baseline.txt", "README.md"):
            self.assertFalse(changes.affects_site([path]), path)

    def test_local_code_scope_does_not_force_publication(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with mock.patch.object(changes, "changed_paths", return_value=[".github/workflows/ci.yml"]):
                changes.main(["push", "before", "after"])
        self.assertEqual(output.getvalue(), "code=true\nsite=false\n")

    def test_player_pages_and_images_publish_without_rebuilding_the_game(self):
        for path in ("docs/player/needs.md", "docs/player/navigation.json", "docs/player/effects.json", "docs/player/images/options-mobile.png"):
            self.assertFalse(changes.affects_game([path]), path)
            self.assertTrue(changes.affects_site([path]), path)

    def test_generated_data_and_short_help_require_game_checks(self):
        for path in ("docs/player/generated/reference.json", "docs/player/reviewed-sources.json", "docs/player/quick-help.md"):
            self.assertTrue(changes.affects_game([path]), path)
            self.assertTrue(changes.affects_site([path]), path)

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
        self.assertTrue(changes.affects_site([]))

    def test_published_markdown_redeploys_without_running_game_checks(self):
        paths = ["docs/player/changelog/2026-10-01-controls.md"]
        self.assertFalse(changes.affects_game(paths))
        self.assertTrue(changes.affects_site(paths))
        self.assertTrue(changes.affects_site(["docs/player/changelog/deleted-entry.md"]))
        self.assertFalse(changes.affects_site(["docs/changelog.md", "docs/FEATURES.md"]))


class DecideFromGit(unittest.TestCase):
    """Against a throwaway repository, so the git diff ranges are real."""

    def setUp(self):
        self.previous = os.getcwd()
        self.folder = tempfile.TemporaryDirectory()
        os.chdir(self.folder.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.base = self.commit({"README.md": "one", "web/src/main.ts": "one"})

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
        code = self.commit({"web/src/main.ts": "two"})
        self.assertTrue(changes.decide("push", docs, code))
        self.assertTrue(changes.decide("push", self.base, code), "any code commit in the push counts")

    def test_a_pull_request_is_compared_from_where_it_branched(self):
        self.git("checkout", "-q", "-b", "feature")
        head = self.commit({"README.md": "two"})
        self.git("checkout", "-q", "main")
        moved_on = self.commit({"web/src/main.ts": "two"})
        self.assertFalse(changes.decide("pull_request", moved_on, head), "main's own code change is not the pull request's")

    def test_a_rename_into_documentation_counts_both_ends(self):
        self.git("mv", "web/src/main.ts", "web/src/main.md")
        self.git("commit", "-q", "-m", "rename")
        self.assertTrue(changes.decide("push", self.base, self.git("rev-parse", "HEAD")))

    def test_deleted_and_renamed_public_inputs_make_old_releases_stale(self):
        added = self.commit({"web/src/main.ts": "published"})
        os.makedirs("docs", exist_ok=True)
        self.git("mv", "web/src/main.ts", "docs/retired-main.ts")
        self.git("commit", "-q", "-m", "move out of publication")
        moved = self.git("rev-parse", "HEAD")
        self.assertTrue(changes.decide_site("compare", added, moved))
        self.git("mv", "docs/retired-main.ts", "web/src/renamed.ts")
        self.git("commit", "-q", "-m", "move into publication")
        restored = self.git("rev-parse", "HEAD")
        self.assertTrue(changes.decide_site("compare", moved, restored))
        os.remove("web/src/renamed.ts")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "delete public input")
        self.assertTrue(changes.decide_site("compare", restored, self.git("rev-parse", "HEAD")))

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

    def test_note_addition_edit_and_deletion_each_require_publication(self):
        added = self.commit({"docs/player/changelog/2026-10-01-controls.md": "first"})
        edited = self.commit({"docs/player/changelog/2026-10-01-controls.md": "second"})
        os.remove("docs/player/changelog/2026-10-01-controls.md")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "remove note")
        removed = self.git("rev-parse", "HEAD")
        for before, after in ((self.base, added), (added, edited), (edited, removed)):
            self.assertFalse(changes.decide("push", before, after))
            self.assertTrue(changes.decide_site("push", before, after))
            self.assertTrue(changes.decide_site("compare", before, after), "new notes make old Pages artifacts stale")

    def test_new_notes_cannot_hide_untested_game_changes(self):
        code = self.commit({"web/src/main.ts": "untested"})
        notes = self.commit({"docs/player/changelog/2026-10-01-controls.md": "first"})
        self.assertFalse(changes.decide("push", code, notes))
        self.assertTrue(changes.decide("push", self.base, notes), "compare from the last tested game, not the previous push")
        self.assertTrue(changes.decide_site("push", self.base, notes))

    def test_unpublished_docs_after_tested_notes_do_not_keep_redeploying(self):
        notes = self.commit({"docs/player/changelog/2026-10-01-controls.md": "first"})
        docs = self.commit({"README.md": "later documentation"})
        with contextlib.redirect_stdout(io.StringIO()) as output:
            changes.main(["push", self.base, docs, notes])
        self.assertEqual(output.getvalue(), "code=false\nsite=false\n")
        with contextlib.redirect_stdout(io.StringIO()) as output:
            changes.main(["push", self.base, docs, self.base])
        self.assertEqual(output.getvalue(), "code=false\nsite=true\n", "unchecked notes still need publication")

    def test_the_answer_is_written_where_the_workflow_reads_it(self):
        docs = self.commit({"README.md": "two"})
        output = os.path.join(self.folder.name, "output.txt")
        previous = os.environ.get("GITHUB_OUTPUT")
        os.environ["GITHUB_OUTPUT"] = output
        try:
            changes.main(["push", self.base, docs])
            code = self.commit({"web/src/main.ts": "two"})
            changes.main(["push", docs, code])
        finally:
            if previous is None:
                del os.environ["GITHUB_OUTPUT"]
            else:
                os.environ["GITHUB_OUTPUT"] = previous
        with open(output, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "code=false\nsite=false\ncode=true\nsite=true\n")


if __name__ == "__main__":
    unittest.main()
