"""Read the reviewed surface owners and update metadata without rewriting geometry."""
from pathlib import Path
import hashlib
import json

BASE = Path(__file__).resolve().parent
POLICY = BASE / 'surface-policy.json'


def policy_sha256():
    return hashlib.sha256(POLICY.read_bytes()).hexdigest()


def owners(policy=POLICY):
    result = {}
    for owner, group in json.loads(policy.read_text(encoding='utf-8'))['owners'].items():
        for name in group['parts']:
            if name in result:
                raise ValueError(f'Duplicate outline ownership: {name}')
            result[name] = (owner, group['outline'])
    return result


def annotate(parts, policy_path=POLICY):
    policy = owners(policy_path)
    for part in parts:
        if part['name'] not in policy:
            raise ValueError(f'Missing authored outline ownership: {part["name"]}')
        part['outlineOwner'], part['outline'] = policy[part['name']]


def update_exported_metadata():
    paths = [BASE / 'export' / 'manifest.json', *sorted((BASE / 'clips').glob('*/parts.json'))]
    for path in paths:
        policy = BASE/'pool-surface-policy-v1.json' if path.parent.name == 'pool' else POLICY
        digest = hashlib.sha256(policy.read_bytes()).hexdigest()
        data = json.loads(path.read_text(encoding='utf-8'))
        descriptions = [data['original'], data['runtime']] if 'original' in data else [data['geometry']]
        for description in descriptions:
            if description:
                annotate(description['parts'], policy)
        data['surfacePolicySha256'] = digest
        path.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    return len(paths)


if __name__ == '__main__':
    print(f'Annotated {update_exported_metadata()} exported metadata files; geometry bytes unchanged.')
