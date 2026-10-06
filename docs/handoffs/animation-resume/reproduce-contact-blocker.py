"""Demonstrate the unresolved contact-area rejection on the handoff checkpoint."""
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT/'assets/models/bathroom/actions'
sys.path.insert(0, str(BASE))
from bathroom_export_contract import validate_contacts


class ContactCertificateRejection(unittest.TestCase):
    def test_near_double_winding_cannot_claim_full_cell_support(self):
        source = json.loads((BASE/'review/toilet/prototype-08-curved-support/proof.json').read_text())
        rows = [dict(variant=variant, frame=frame, phase=frame/4,
                     physical_metrics=copy.deepcopy(source['physical_metrics']),
                     curved_support=copy.deepcopy(source['curved_support']))
                for variant in ('green', 'blue', 'red') for frame in range(5)]
        validate_contacts(rows)
        for cell in rows[0]['curved_support']['continuous_cells']:
            ix, iy = cell['cell']
            for side, certificate in enumerate(cell['mirrored_pair']):
                x = (ix if side == 0 else -ix-1)*.003
                y = -.1+iy*.003
                rectangle = [[x, y], [x+.0015, y], [x+.0015, y+.003], [x, y+.003]]
                shifted = [[px+1e-10, py] for px, py in rectangle]
                certificate['partitions'] = [dict(body_triangle=0, seat_triangle=0,
                    polygon_xy=rectangle+shifted,
                    gaps=[certificate['min_gap'], certificate['max_gap']]*4)]
        with self.assertRaises(ValueError):
            validate_contacts(rows)


if __name__ == '__main__':
    unittest.main()
