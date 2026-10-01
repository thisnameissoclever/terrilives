"""Append fitted ottoman Sit layers while retaining the published empty sprites."""
from offline_seating import load_seating
from ottoman_receipt import load_receipt


def load_ottoman(manifest_path, *, existing_names):
    return load_seating(manifest_path, prefix='offlineOttoman', half_cycle_ticks=10,
                        reuse_empty=True, existing_names=existing_names)


def load_reviewed_ottoman(catalog_path, *, existing_names):
    paths = load_receipt(catalog_path)
    return load_ottoman(paths['manifest'], existing_names=existing_names)
