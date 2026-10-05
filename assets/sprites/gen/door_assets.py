"""Append checked model renders without changing historical sprite identities."""
import hashlib
import json
from pathlib import Path
from PIL import Image

SOURCE = Path(__file__).resolve().parents[2] / 'models/doors'
CONFIG = json.loads((SOURCE / 'doors.json').read_text())
BASE = (SOURCE / CONFIG['batch']).resolve()
assert CONFIG['schema'] == 1
assert BASE.is_relative_to(SOURCE.resolve()), 'door batch escapes source'
MODEL_ROOT = SOURCE.parent
if BASE != (SOURCE / 'export').resolve():
    assert CONFIG.get('requireIndependentReview') is True, 'new door batches require independent source-art review'


def records():
    manifest = json.loads((BASE / 'manifest.json').read_text())
    if CONFIG.get('requireIndependentReview'):
        review = json.loads((BASE / 'review.json').read_text())
        assert review['status'] == 'accepted' and review['independent'] is True, 'door independent review pending'
        assert review['manifestSha256'] == hashlib.sha256((BASE / 'manifest.json').read_bytes()).hexdigest(), 'reviewed door manifest changed'
        assert review['sceneSha256'] == hashlib.sha256((BASE / 'doors.blend').read_bytes()).hexdigest(), 'reviewed door scene changed'
        assert review['statusSha256'] == hashlib.sha256((BASE / 'status.json').read_bytes()).hexdigest(), 'reviewed door receipt changed'
        audit_ref = review['editableSceneAudit']
        audit_path = (BASE / audit_ref['file']).resolve()
        assert audit_path.is_relative_to(BASE), 'door scene audit escapes batch'
        assert hashlib.sha256(audit_path.read_bytes()).hexdigest() == audit_ref['sha256'], 'door scene audit changed'
        audit = json.loads(audit_path.read_text())
        assert audit['state'] == 'complete' and audit['background'] is True, 'door scene audit incomplete'
        assert audit['sceneSha256Before'] == audit['sceneSha256After'] == review['sceneSha256'], 'audited door scene changed'
        audit_script = MODEL_ROOT / 'doors/audit_scene.py'
        assert hashlib.sha256(audit_script.read_bytes()).hexdigest() == audit['auditScriptSha256'], 'door scene auditor changed'
    expected = [name for facing in range(4) for name in
                [f'doorFrame{facing}', *[f'doorLeaf{facing}_{phase}' for phase in range(9)]]]
    assert [r['name'] for r in manifest['records']] == expected
    assert manifest['density'] == 3 and manifest['canvas'] == [112, 120]
    for relative, expected_hash in manifest['inputs'].items():
        path = MODEL_ROOT / relative
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_hash, relative
    result = []
    for record in manifest['records']:
        for suffix in ('', 'Depth'):
            name = record['name'] + suffix
            path = BASE / f'{name}.png'
            assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'][suffix], name
            image = Image.open(path).convert('RGBA')
            assert image.size == (336, 360), name
            result.append((name, image, *image.size))
    return result
