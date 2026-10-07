"""Share identical immutable coverage payloads without changing record indices."""
import json


def coverage_table(records):
    values, indices, known = [], [], {}
    for record in records:
        key = json.dumps(record, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if key not in known:
            known[key] = len(values)
            values.append(record)
        indices.append(known[key])
    return values, indices
