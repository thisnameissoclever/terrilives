"""Exercise invalid catalogue acceptance without editing the running generator."""
import hashlib
from pathlib import Path
import sys
import unittest

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'assets/sprites/gen'))
import conversation_icons

path = root / 'assets/sprites/gen/conversation_icons.py'
original = path.read_bytes()
source = original.decode('utf-8')
if sys.argv[1] == 'pixels':
    old = "catalogue.get('version') != 1 or catalogue.get('sprites') != actual"
    new = "catalogue.get('version') != 1"
elif sys.argv[1] == 'dimensions':
    old = "if any(image.mode != 'RGBA' or image.size != (width, height)\n           for _, image, width, height in sprites):"
    new = 'if False:'
else:
    raise ValueError('Expected pixels or dimensions')
assert source.count(old) == 1
exec(compile(source.replace(old, new), str(path), 'exec'), conversation_icons.__dict__)
suite = unittest.defaultTestLoader.loadTestsFromName(
    'test_conversation_icons.ConversationIconTests.test_reviewed_extension_is_registered_and_rejects_pixel_changes')
result = unittest.TextTestRunner().run(suite)
assert path.read_bytes() == original, 'Source bytes changed during the mutation check'
print('Unchanged source SHA-256:', hashlib.sha256(original).hexdigest())
assert result.testsRun == 1 and not result.errors
assert len(result.failures) == 1, 'Expected one rejected catalogue assertion'
assert 'AssertionError: ValueError not raised' in result.failures[0][1]
print('Mutation rejected:', sys.argv[1])
