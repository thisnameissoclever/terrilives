"""Decide whether a change can affect the game, or is documentation only.

CI runs the Rust, web and mutation jobs only when this says the game could
be affected. Published Markdown in docs/changelog also affects the site:
CI checks the changelog and Pages redeploys it without requiring game checks
for a notes-only edit. Other documentation runs the documentation id check.

A path is documentation when it is a Markdown file outside the agent skill
folders. Those skill files are read by `web/tests/agent-skill-mirrors.test.ts`,
so a change to one is a change the web tests must see. Every other path,
including `docs/mutants-baseline.txt`, which the mutation gate reads, counts
as able to affect the game.

When in doubt this answers "the game could be affected": a manual run, a
push with no previous commit to compare against, an empty or failed diff.
Skipping checks wrongly costs a broken main; running them needlessly only
costs time.

Usage in a workflow step:

    python3 .github/scripts/changes.py <event> <base> <head> [site_base]

writes `code` and `site` booleans to $GITHUB_OUTPUT and stdout.
`<event>` is `pull_request`, `push` or `compare`. A pull request is
compared from where it branched; `push` and `compare` compare two commits
directly. For a push to main the workflow passes the newest main revision
whose game CI passed as the base, so everything since the last tested game
counts. `site_base` is the newest successful main push whose changelog or game
was checked, so unrelated documentation after a notes edit can still skip
publication. Without a separate site base, comparisons use the game base.
"""

import os
import subprocess
import sys

SKILL_FOLDERS = (".agents/", ".claude/")


def is_documentation(path: str) -> bool:
    """Whether a changed path is documentation that nothing executes."""
    return path.lower().endswith(".md") and not path.startswith(SKILL_FOLDERS)


def affects_game(paths: list[str]) -> bool:
    """Whether the checks that build and test the game must run."""
    if not paths:
        return True
    return not all(is_documentation(path) for path in paths)


def affects_site(paths: list[str]) -> bool:
    """Published notes are site content even when the game is unchanged."""
    return affects_game(paths) or any(path.startswith("docs/changelog/") for path in paths)


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
    site = code or decide_site(event, site_base, head)
    lines = f"code={'true' if code else 'false'}\nsite={'true' if site else 'false'}"
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(lines + "\n")
    print(lines)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
