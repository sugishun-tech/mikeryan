"""Generate deterministic signed, public TEST events for the wire benchmark.
Never use these test private keys for actual accounts. Requires cryptography.
"""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from fixture_signer import sign

def generate():
    now = 1_780_000_000
    profiles = [sign(dict(kind=0, tags=[], created_at=now-i,
        content=json.dumps(dict(name=f'user{i:02d}', display_name=f'利用者{i:02d}', about='通信計測用の公開テストデータ。'), ensure_ascii=False)), 100+i) for i in range(40)]
    pages = []
    for page_index in range(3):
        authors = list(range(30)) if page_index < 2 else list(range(20)) + list(range(30,40))
        pages.append([sign(dict(kind=1, tags=[['client','fixture']], created_at=now-1000-page_index*100-i,
            content=f'ページ{page_index+1}・投稿{i+1}の通信計測用テキスト。'), 100+author) for i,author in enumerate(authors)])
    reactions = [sign(dict(kind=7, tags=[['e',event['id']],['p',event['pubkey']]], created_at=now-500,
        content='+'), 999) for page in pages for event in page]
    # A second relay's fresh update and older historical duplicates test recovery.
    updated = sign(dict(kind=0, tags=[], created_at=now+100, content='{"name":"updated-on-second-relay"}'), 100)
    history = [sign(dict(kind=0, tags=[], created_at=now-1-i, content=json.dumps({'name':f'old{i}'})), 100) for i in range(8)]
    capped_update = sign(dict(kind=0, tags=[], created_at=now-28, content='{"name":"newer-on-capped-relay"}'), 129)
    invalid_profile = sign(dict(kind=0, tags=[], created_at=now+200, content='not a JSON profile'), 101)
    return dict(invalidProfile=invalid_profile, cappedUpdate=capped_update, profiles=profiles, pages=pages, reactions=reactions, user=reactions[0]['pubkey'], updated=updated, history=history)

if __name__ == '__main__':
    path = ROOT/'tests/fixtures/traffic.json'
    path.write_text(json.dumps(generate(), ensure_ascii=False, indent=2)+'\n')
    print(path)
