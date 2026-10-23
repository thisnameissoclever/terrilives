from pathlib import Path
import json
import sys

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '.github/scripts'))
import mutation_campaign as model

source = root / '.local-build/build-ui-followup/isolated-tool/v20/reports'
listing = json.loads((source / 'candidate-inventory.stdout').read_bytes())
snapshot = json.loads((source / 'freeze-before-stock.json').read_bytes())
rows = []
for index, item in enumerate(listing):
    row = model._identity(item, with_diff=True)
    row['id'] = model.digest(row)
    row['slot'] = index % 8
    rows.append(row)
inventory = snapshot['inputs']
shape = {'manifest': {'context': {'inputs': {'input_inventory': inventory,
         'generation_order': [item['name'] for item in listing]}}, 'mutations': rows}}
pretty = json.dumps(shape, sort_keys=True, indent=2, allow_nan=False).encode()
compact = json.dumps(shape, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
receipt = {'diagnostic_sizing_only': True, 'accepted_outcomes': 0,
           'native_revision': '0b886b73d8fb0492fe8e8029957e0fc1db5715a7',
           'mutation_count': len(rows), 'pretty_plan_lower_bound_bytes': len(pretty),
           'compact_plan_lower_bound_bytes': len(compact), 'member_cap_bytes': 32 * 1024 * 1024,
           'omissions': 'Other context, manifest, calibration, capacity and producer fields are omitted, so these are lower bounds, not actual plans or execution evidence.'}
(root / '.superpowers/sdd/mutation-campaign-repair-plan/native-plan-size-probe.json').write_bytes((json.dumps(receipt, indent=2) + '\n').encode())
print(json.dumps(receipt))
