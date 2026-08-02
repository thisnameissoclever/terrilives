#!/usr/bin/env python3
"""Keeps the docs' own ids allocation-free and unique.

`docs/lessons-learned.md` and `docs/alpha-feel-notes.md` accrete one
entry per branch. Their ids used to be the next free integer, which is
an allocator every branch reads the same way: on 2026-08-01 three PRs
each appended what they believed was `[A-17]`, and the numeric series
had already collided once before that (two different `[L41]`s, main's
renumbered to `[L49]`). New ids are slugs instead, so there is nothing
to race for.

This script fails the build on the two ways that can still go wrong:

1. a NUMBERED id past the closed series - somebody reached for the
   counter again, and the next parallel branch will reach for the same
   number;
2. the same id twice in one file - two branches picked the same slug,
   which `merge=union` would silently keep both of (see
   `.gitattributes`).

Existing numbers never move: 60 files across the repo cite them.

Run with no arguments from the repository root. Exits non-zero and says
what to do on failure, so it reads the same in CI and in a terminal.
"""

from __future__ import annotations

import re
import sys

# The last number each series ever allocated. Anything above this is a
# new entry that reached for the counter. These do not change when
# entries are added - only if a numbered entry were ever legitimately
# added, which is what this script exists to prevent.
CLOSED = {
    "docs/lessons-learned.md": ("L", 73),
    "docs/alpha-feel-notes.md": ("A", 24),
}

HEADING = re.compile(r"^#{2,3} \[([A-Z])-?([^\]]+)\]")


def check(path: str, prefix: str, closed: int) -> list[str]:
    problems: list[str] = []
    seen: dict[str, int] = {}
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError as error:
        return [f"{path}: cannot be read ({error})"]

    for number, line in enumerate(lines, start=1):
        match = HEADING.match(line)
        if match is None:
            continue
        letter, rest = match.groups()
        if letter != prefix:
            continue
        ident = f"[{letter}{'' if rest[0].isdigit() else '-'}{rest}]"

        if rest.isdigit() and int(rest) > closed:
            problems.append(
                f"{path}:{number}: {ident} reaches for the counter, and the "
                f"{prefix} series is closed at {prefix}{closed}. Give the entry "
                f"a slug instead - `## [{prefix}-what-it-is-about] ...` - so no "
                f"other branch can pick the same id. The file's header says why."
            )

        if ident in seen:
            problems.append(
                f"{path}:{number}: {ident} is already used at line {seen[ident]}. "
                f"Two branches picked the same id; rename the newer one. Note "
                f"that `merge=union` keeps both sides of an overlapping append, "
                f"so this is how a duplicate arrives without a merge conflict."
            )
        else:
            seen[ident] = number

    if not seen:
        problems.append(
            f"{path}: no {prefix} ids found at all, so this check is asserting "
            f"nothing. Has the heading format changed?"
        )
    return problems


def main() -> int:
    problems: list[str] = []
    for path, (prefix, closed) in CLOSED.items():
        problems.extend(check(path, prefix, closed))

    if problems:
        print("Documentation ids need a fix:\n", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}\n", file=sys.stderr)
        return 1

    print("Documentation ids are unique and allocation-free.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
