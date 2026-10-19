"""Copy reviewed proof helpers into the isolated V20 evidence directory."""
from pathlib import Path

root = Path(__file__).resolve().parent
previous = root.parent
(root / "receipt_compare.py").write_bytes((previous / "receipt_compare.py").read_bytes())
source = (previous / "freeze-proof.py").read_text()
source = source.replace('ROOT / "game-source"', 'ROOT / "source"')
source = source.replace("ac25b9b2f40aa2d48d97f02afbaa4e1223ca200d", "0b886b73d8fb0492fe8e8029957e0fc1db5715a7")
source = source.replace('ROOT / ("freeze-"', 'ROOT / "reports" / ("freeze-"')
source = source.replace('ROOT / "freeze-before-stock.json"', 'ROOT / "reports" / "freeze-before-stock.json"')
source = source.replace('pending = []', 'assert not SOURCE.is_symlink() and not SOURCE.is_junction()\npending = []')
source = source.replace('        assert not path.is_symlink() and not path.is_junction()', '        for ancestor in (path, *path.parents):\n            if ancestor == SOURCE:\n                break\n            assert not ancestor.is_symlink() and not ancestor.is_junction()')
(root / "input-proof.py").write_text(source)
print("Reviewed canonical comparison and full batched link guards prepared for V20.")
