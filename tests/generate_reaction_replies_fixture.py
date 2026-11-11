"""Re-sign recorded reaction-reply fixtures using the public test-only example keys.
Runtime tests read the generated JSON and need Node only, not Python cryptography.
When adding a signing scenario, add its exact template and example_key (secret)
to reaction-replies.json, then run this script. Keep the fixed created_at values
aligned with fixtureClock / original in reaction-replies.test.js.
"""
import json
from pathlib import Path
from fixture_signer import sign

path = Path(__file__).parent / 'fixtures' / 'reaction-replies.json'
rows = json.loads(path.read_text())
for row in rows:
    if row['secret'] not in (3, 4, 5, 6):
        raise ValueError('Only the public deterministic fixture keys are permitted')
    row['event'] = sign(row['template'], row['secret'])
path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(f'Regenerated {len(rows)} deterministic signatures: {path}')
