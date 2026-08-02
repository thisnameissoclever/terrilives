#!/usr/bin/env python3
"""Keeps the docs' own ids allocation-free and unique.

`docs/lessons-learned.md` and `docs/alpha-feel-notes.md` accrete one
entry per branch. Their ids used to be the next free integer, which is
an allocator every branch reads the same way: on 2026-08-01 three PRs
each appended what they believed was `[A-17]`, and the numeric series
had already collided once before that (two different `[L41]`s, main's
renumbered to `[L49]`). New ids are slugs instead, so there is nothing
to race for.

This script fails the build on the three ways that can still go wrong:

1. a NUMBERED id past the closed series - somebody reached for the
   counter again, and the next parallel branch will reach for the same
   number;
2. an id that merely STARTS with a number - `[L74-something]` is the
   same allocation wearing a slug's clothes;
3. the same id twice in one file - two branches picked the same slug,
   which `merge=union` would silently keep both of (see
   `.gitattributes`).

Fenced examples are skipped: both files show the format in a code
block, and reserving the id in an example against the first real entry
to use it would be a duplicate report for something that does not
exist.

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
FENCE = re.compile(r"^\s*(```|~~~)")


def key_of(letter: str, body: str) -> str:
    """The id, normalised so the two series' formats compare equal.

    The two files disagree, and both are internally consistent: every
    lesson is `[L73]` and every session is `[A-24]`. Normalising the
    optional dash away means a `[A-24]` and an `[A24]` written on two
    branches are still caught as one duplicate. Only the KEY is
    normalised - messages quote the heading as written, or the line
    number they point at would not match what a reader greps for.
    """
    return f"{letter}{body}".replace("-", "", 1) if body[:1].isdigit() else f"{letter}{body}"


def check(path: str, prefix: str, closed: int) -> list[str]:
    problems: list[str] = []
    seen: dict[str, tuple[int, str]] = {}
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError as error:
        return [f"{path}: cannot be read ({error})"]

    # Both files SHOW the id format in a fenced example, and a fenced
    # example is not an id. Counting one made the guard reserve
    # `[A-alpha-acceptance]` against the first real entry to use it -
    # a duplicate report for an id that does not exist.
    in_fence = False
    for number, line in enumerate(lines, start=1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = HEADING.match(line)
        if match is None:
            continue
        letter, body = match.groups()
        if letter != prefix:
            continue
        written = line.strip().split("]", 1)[0].lstrip("# ") + "]"
        key = key_of(letter, body)

        if body.isdigit():
            # A historical id. Legal only up to the close.
            if int(body) > closed:
                problems.append(
                    f"{path}:{number}: {written} reaches for the counter, and "
                    f"the {prefix} series is closed at {closed}. Give the entry "
                    f"a slug instead - `## [{prefix}-what-it-is-about] ...` - so "
                    f"no other branch can pick the same id. The file's header "
                    f"says why."
                )
        elif body[:1].isdigit():
            # Starts with a number but is not one: `[L74-something]`,
            # `[A-25-anything]`. Still an allocation from the counter,
            # wearing a slug's clothes, and the pure-digit test above
            # would wave it through.
            problems.append(
                f"{path}:{number}: {written} starts with a number. A new id is "
                f"a slug and begins with a LETTER; only the closed numeric "
                f"series ({prefix}1-{prefix}{closed}) may start with a digit. "
                f"Anything derived from a count is an allocation, which is what "
                f"the slug scheme exists to remove."
            )

        if key in seen:
            first_line, first_written = seen[key]
            problems.append(
                f"{path}:{number}: {written} is already used at line "
                f"{first_line} (as {first_written}). Two branches picked the "
                f"same id; rename the newer one. Note that `merge=union` keeps "
                f"both sides of an overlapping append, so this is how a "
                f"duplicate arrives without a merge conflict."
            )
        else:
            seen[key] = (number, written)

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
