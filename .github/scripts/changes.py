"""Classify local validation scope and actual Pages publication inputs.

Local game checks deliberately treat unknown non-Markdown paths conservatively.
Pages uses only PAGES_PATHS, whose ordered patterns must equal the workflow's
push filter. Unknown history and failed or empty diffs require publication.

`changes.py <event> <base> <head> [site_base]` writes independent `code` and
`site` booleans. Pull requests compare from the merge base. Push and compare
events compare the two exact commits. An optional site base changes only the
publication comparison.
"""

import os
import re
import subprocess
import sys

SKILL_FOLDERS = (".agents/", ".claude/")

# GitHub's ordered path-filter subset: *, **, **/ and leading ! exclusions.
# Keep this identical to pages.yml. Tests verify equality and actual build inputs.
PAGES_PATHS = (
    ".github/workflows/pages.yml", ".github/scripts/changes.py",
    "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/**",
    "crates/*/Cargo.toml", "crates/*/build.rs", "crates/*/src/**",
    "!crates/*/src/**/tests/**", "!crates/*/src/**/tests.rs",
    "!crates/*/src/**/*_tests.rs", "!crates/*/src/test_content.rs",
    "crates/terri-data/build_pre_books.rs",
    "crates/terri-data/tests/fixtures/pre-books/*.toml",
    "crates/terri-data/tests/fixtures/pre-books/source-revision.txt",
    "crates/terri-data/tests/fixtures/pre-books-920abaf/*.toml",
    "crates/terri-data/tests/fixtures/pre-books-920abaf/source-revision.txt",
    "crates/terri-data/tests/fixtures/pre-books-f3cb7a1c/*.toml",
    "crates/terri-data/tests/fixtures/pre-books-f3cb7a1c/source-revision.txt",
    "crates/terri-data/tests/fixtures/pre-books-89040f82/*.toml",
    "crates/terri-data/tests/fixtures/pre-books-89040f82/source-revision.txt",
    "crates/terri-data/tests/fixtures/pre-books-2f319c3b/*.toml",
    "crates/terri-data/tests/fixtures/pre-books-2f319c3b/source-revision.txt",
    "content/*.toml", "assets/sprites/atlas.toml",
    "assets/models/kitchen/wall-registration.json", "assets/models/architecture-depth.json",
    "assets/models/sims/character-creator/surface-policy.json",
    "assets/models/sims/character-creator/export/manifest.json",
    "assets/models/sims/character-creator/export/runtime*.bin",
    "assets/models/sims/character-creator/clips/clips.json",
    "assets/models/sims/character-creator/clips/**/runtime*.bin",
    "assets/models/sims/character-creator/clips/*/parts.json",
    "assets/models/sims/character-repair/fixture-depth/manifest.json",
    "assets/models/sims/character-repair/fixture-depth/*.rgba",
    "assets/models/sims/character-repair/aquarium-depth/manifest.json",
    "assets/models/sims/character-repair/aquarium-depth/*.rgba",
    "assets/models/sims/character-repair/outdoor-depth/manifest.json",
    "assets/models/sims/character-repair/outdoor-depth/*.rgba",
    "assets/models/sims/character-repair/shelf-depth/manifest.json",
    "assets/models/sims/character-repair/shelf-depth/*.rgba",
    "assets/models/sims/character-repair/components/manifest.json",
    "assets/models/sims/character-repair/components/*.rgba",
    "assets/models/sims/character-repair/dropped-book/manifest.json",
    "assets/models/sims/character-repair/dropped-book/*.rgba",
    "web/src/**", "!web/src/**/*.test.*", "!web/src/**/*.spec.*",
    "!web/src/**/__tests__/**", "web/public/**", "web/index.html",
    "web/package.json", "web/package-lock.json", "web/vite.config.ts",
    "web/tsconfig.json", "web/changelog/**", "web/guide/**", "web/startup-report/**",
    "docs/player/**", "scripts/build-changelog.mjs",
    "scripts/build-player-guide.mjs", "scripts/player-markdown.mjs",
    "scripts/player-coverage.mjs", "scripts/player-illustrations.mjs",
    "scripts/player-activity-filters.mjs",
)


def publication_pattern_matches(pattern: str, path: str) -> bool:
    """Match the workflow's restricted path-glob syntax without shell expansion."""
    tokens = re.split(r"(\*\*/|\*\*|\*)", pattern)
    expression = "".join({"**/": "(?:.*/)?", "**": ".*", "*": "[^/]*"}.get(token, re.escape(token))
                         for token in tokens)
    return re.fullmatch(expression, path) is not None


def is_publication_input(path: str) -> bool:
    """Apply ordered inclusion and exclusion rules used by the Pages trigger."""
    included = False
    for pattern in PAGES_PATHS:
        exclude = pattern.startswith("!")
        if publication_pattern_matches(pattern.removeprefix("!"), path):
            included = not exclude
    return included


def is_documentation(path: str) -> bool:
    """Whether a changed path is documentation that nothing executes."""
    if path == "docs/player/quick-help.md" or path == "docs/player/reviewed-sources.json" or path.startswith("docs/player/generated/"):
        return False
    if path.startswith("docs/player/"):
        return True
    return path.lower().endswith(".md") and not path.startswith(SKILL_FOLDERS)


def affects_game(paths: list[str]) -> bool:
    """Whether the checks that build and test the game must run."""
    if not paths:
        return True
    return not all(is_documentation(path) for path in paths)


def affects_site(paths: list[str]) -> bool:
    """Whether changed production inputs require a new public build."""
    return not paths or any(is_publication_input(path) for path in paths)


def changed_paths(base: str, head: str, merge_base: bool) -> list[str]:
    """Every path changed between two commits, or none when git cannot say.

    Renames are listed as a deletion and an addition, so moving a file out of
    or into a documentation path is seen from both ends. A failed diff, such
    as a push whose previous commit is all zeros because it opened the
    branch, lists nothing, and an empty list runs the checks.
    """
    spread = f"{base}...{head}" if merge_base else f"{base}..{head}"
    result = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", spread],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line]


def decide(event: str, base: str, head: str) -> bool:
    """Whether this event's change could affect the game."""
    if event not in ("pull_request", "push", "compare"):
        return True
    if not base or not head:
        return True
    return affects_game(changed_paths(base, head, merge_base=event == "pull_request"))


def decide_site(event: str, base: str, head: str) -> bool:
    """Whether Pages must publish the tested revision's game or notes."""
    if event not in ("pull_request", "push", "compare") or not base or not head:
        return True
    return affects_site(changed_paths(base, head, merge_base=event == "pull_request"))


def main(argv: list[str]) -> int:
    event, base, head = (argv + ["", "", ""])[:3]
    site_base = argv[3] if len(argv) > 3 else base
    code = decide(event, base, head)
    site = decide_site(event, site_base, head)
    lines = f"code={'true' if code else 'false'}\nsite={'true' if site else 'false'}"
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(lines + "\n")
    print(lines)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
