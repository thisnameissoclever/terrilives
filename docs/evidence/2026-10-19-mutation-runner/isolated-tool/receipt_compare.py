"""Compare persisted receipt meaning without Python tuple/JSON array differences."""
import json

def assert_receipts_equal(actual, expected):
    assert json.loads(json.dumps(actual)) == expected, "Frozen input receipts differ"
