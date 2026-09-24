"""TEST ONLY. Public, deterministic example keys. NEVER fund or use these accounts.
Only this test directory contains signing code. The application signs with NIP-07.
Independent affine public-point generation via Python cryptography/OpenSSL.
"""
import hashlib
import json
import time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141

def point(scalar: int):
    return ec.derive_private_key(scalar, ec.SECP256K1()).public_key().public_numbers()

def taghash(tag: str, data: bytes) -> bytes:
    h = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(h + h + data).digest()

def b32(value: int) -> bytes:
    return value.to_bytes(32, 'big')

def sign(template: dict, example_key: int = 3) -> dict:
    p = point(example_key)
    d = N - example_key if p.y & 1 else example_key
    event = dict(template, pubkey=f'{p.x:064x}')
    event.setdefault('created_at', int(time.time()))
    raw = json.dumps([0,event['pubkey'],event['created_at'],event['kind'],event['tags'],event['content']], ensure_ascii=False, separators=(',', ':')).encode()
    message = hashlib.sha256(raw).digest()
    aux = taghash('BIP0340/aux', bytes(32))
    t = bytes(a ^ b for a,b in zip(b32(d),aux))
    k0 = int.from_bytes(taghash('BIP0340/nonce',t+b32(p.x)+message),'big') % N
    if not k0: raise ValueError('Invalid test nonce')
    r = point(k0); k = N-k0 if r.y & 1 else k0
    e = int.from_bytes(taghash('BIP0340/challenge', b32(r.x)+b32(p.x)+message),'big') % N
    event.update(id=message.hex(), sig=(b32(r.x)+b32((k+e*d)%N)).hex())
    return event

def fixtures():
    keys = {name:f'{point(n).x:064x}' for name,n in [('alice',3),('bob',4),('carol',5),('dave',6)]}
    events=[]; now=int(time.time())-60
    def event(kind,content,tags=None,secret=3,created=None):
        e=sign(dict(kind=kind,content=content,tags=tags or [],created_at=created or now),secret);events.append(e);return e
    names=[('alice','アリス',3),('bob','ボブ',4),('carol','キャロル',5),('dave','デイブ',6)]
    for name,display,key in names:
        metadata={'name':name,'display_name':display,'about':'静かなタイムラインで、考えたことや日々のことを書いています。','website':'https://example.com','custom_field':{'preserved':True}}
        if name=='alice': metadata['nip05']='alice@example.com'
        if name=='bob': metadata['nip05']='bob@example.com'
        if name=='carol': metadata['nip05']='alice@example.com' # deliberate mismatch
        if name=='dave': metadata['nip05']='dave@offline.example.com'
        event(0,json.dumps(metadata,ensure_ascii=False),secret=key,created=now-500)
    event(3,json.dumps({'wss://example.com':{'read':True,'write':True}}),[['p',keys['bob']],['x','preserve-me']],created=now-100)
    event(3,'',[['p',keys['alice']]],secret=4,created=now-100)
    event(3,'',[['p',keys['alice']]],secret=5,created=now-300)
    event(3,'',[],secret=5,created=now-50) # no longer follows; stale #p candidate
    event(3,'',[['p',keys['alice']]],secret=6,created=now-100)
    event(10000,'',[['p',keys['carol']]],created=now-100)
    event(10002,'',[['r','wss://relay.example.com','read'],['r','wss://write.example.com','write']],created=now-100)
    notes=['朝の散歩を終えて、コーヒーを淹れました。今日もいい一日に。','通信を増やさず、必要なときだけ読む。そんな使い方が気に入っています。','静かな場所で考える時間は大切ですね。今日は本を一冊読み終えました。','小さな改善を積み重ねる。昨日より少し使いやすくなりました。']
    for i in range(55):
        event(1,notes[i%4]+f'\nテスト投稿 {i+1}',[['client','mikeryan']],secret=3+i%4,created=now-i*60)
    root=next(e for e in events if e['kind']==1)
    reply=event(1,'この考え方に賛成です。返信も同じ画面で読めます。',[['e',root['id'],'','root'],['p',root['pubkey']],['client','mikeryan']],secret=4,created=now+20)
    event(1,'会話の続きです。',[['e',root['id'],'','root'],['e',reply['id'],'','reply'],['p',keys['bob']]],secret=3,created=now+21)
    event(7,'+',[['e',root['id']],['p',root['pubkey']]],secret=4,created=now+22)
    event(7,'+',[['e',next(e for e in events if e['kind']==1 and e['pubkey']==keys['bob'])['id']],['p',keys['bob']]],created=now+23)
    event(1,'<img src=x onerror="window.hacked=true"> 安全なテキスト表示',secret=4,created=now-3600)
    return dict(keys=keys,events=events,root=root['id'],reply=reply['id'])

if __name__ == '__main__':
    path=Path(__file__).parent/'fixtures'/'events.json'
    path.write_text(json.dumps(fixtures(),ensure_ascii=False,indent=2)+'\n')
    print(path)
