"""New props must follow the accepted bunk records, never shift them."""
import json
from pathlib import Path
import tempfile
import unittest

from offline_batches import load_batches

MODELS = Path(__file__).resolve().parents[2]/'models'


class BatchOrderTests(unittest.TestCase):
    def load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'batches.json'
            path.write_text(json.dumps(value))
            return load_batches(path, model_root=MODELS)

    def test_desk_appends_after_all_76_bunk_records(self):
        batches = load_batches(MODELS/'atlas-batches.json')
        self.assertGreaterEqual(len(batches), 3)
        self.assertEqual([kind for kind, _ in batches[:3]], ['static', 'bunk', 'static'])
        first = batches[0][1][0]
        bunk = batches[1][1].sprites
        desk = batches[2][1][0]
        self.assertEqual((len(first), len(bunk)), (48, 76))
        self.assertGreaterEqual(len(desk), 4)
        self.assertEqual(first[-1][0], 'offlineDoubleBedNE')
        self.assertEqual(bunk[0][0], 'offlineBunk')
        self.assertEqual([row[0] for row in desk[:4]],
                         ['offlineDesk', 'offlineDeskNW', 'offlineDeskSW', 'offlineDeskNE'])

    def test_duplicate_batch_cannot_silently_reuse_sprite_indices(self):
        row = {'kind':'static', 'catalog':'static-props-02.json'}
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.load({'version':1, 'batches':[row, row]})

    def test_unknown_empty_and_escaping_batches_are_rejected(self):
        for value in ({'version':2, 'batches':[]}, {'version':1, 'batches':[]},
                      {'version':1, 'batches':[{'kind':'unknown','catalog':'static-props.json'}]},
                      {'version':1, 'batches':[{'kind':'static','catalog':'../outside.json'}]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load(value)


if __name__ == '__main__':
    unittest.main()
