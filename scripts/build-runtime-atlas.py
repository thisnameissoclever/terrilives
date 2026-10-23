"""Build or verify exact runtime atlas storage without modifying original artwork."""
import argparse
from pathlib import Path

from runtime_atlas import check, generate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify committed resources without writing repository files')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.check:
        check(root)
    else:
        generate(root)
        check(root)


if __name__ == '__main__':
    main()
