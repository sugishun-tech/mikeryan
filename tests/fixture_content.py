"""Independent signed, PUBLIC TEST-KEY fixtures for rich content regressions."""
import json
from pathlib import Path
from fixture_signer import sign, point

ALPHABET='qpzry9x8gf2tvdw0s3jn54khce6mua7l'
def bech32(hrp, data):
    bits=0; acc=0; words=[]
    for value in data:
        acc=(acc<<8)|value; bits+=8
        while bits>=5:
            bits-=5;words.append((acc>>bits)&31)
    if bits: words.append((acc<<(5-bits))&31)
    values=[ord(c)>>5 for c in hrp]+[0]+[ord(c)&31 for c in hrp]+words+[0]*6
    chk=1
    for value in values:
        top=chk>>25;chk=((chk&0x1ffffff)<<5)^value
        for i,g in enumerate([0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3]):
            if (top>>i)&1:chk^=g
    chk^=1
    return hrp+'1'+''.join(ALPHABET[w] for w in words+[(chk>>(5*(5-i)))&31 for i in range(6)])

def tlv(kind,value):
    assert len(value)<=255
    return bytes([kind,len(value)])+value

def content_fixtures():
    keys={name:f'{point(n).x:064x}' for name,n in [('alice',3),('bob',4),('carol',5)]}
    events={}; time=1790722800
    def add(name,content='',kind=1,tags=None,key=3,stamp=None):
        e=sign(dict(kind=kind,tags=tags or [],content=content,created_at=stamp or time+len(events)),key)
        events[name]=e;return e
    for i,(name,key) in enumerate([('alice',3),('bob',4),('carol',5)]):
        add(name+'Profile',json.dumps(dict(name=name,display_name={'alice':'アリス','bob':'ボブ','carol':'キャロル'}[name],about='プロフィール紹介文'),ensure_ascii=False),kind=0,key=key)
    deep=add('deep','最大深度を超えて取得してはいけない投稿',key=5)
    deep_uri='nostr:'+bech32('note',bytes.fromhex(deep['id']))
    original=add('original',f'元の投稿です。入れ子はリンクのみ。{deep_uri} https://media.example/nested.jpg https://youtu.be/M7lc1UVf-VE',key=4)
    original_uri='nostr:'+bech32('note',bytes.fromhex(original['id']))
    add('oldArticle','旧記事',30023,[['d','article:日本語'],['title','旧版']],4,time-20)
    article=add('article','最新版の記事。'+deep_uri,30023,[['d','article:日本語'],['title','記事']],4)
    add('otherArticle','違う識別子',30023,[['d','other']],4)
    coord=f"30023:{keys['bob']}:article:日本語"
    address=bech32('naddr',tlv(0,'article:日本語'.encode())+tlv(2,bytes.fromhex(keys['bob']))+tlv(3,(30023).to_bytes(4,'big')))
    npub=bech32('npub',bytes.fromhex(keys['bob']))
    nprofile=bech32('nprofile',tlv(0,bytes.fromhex(keys['bob']))+tlv(1,b'wss://unconfigured.example'))
    nevent=bech32('nevent',tlv(0,bytes.fromhex(original['id']))+tlv(1,b'wss://unconfigured.example')+tlv(2,bytes.fromhex(keys['bob']))+tlv(3,(1).to_bytes(4,'big')))
    uris=dict(note=original_uri,nevent='nostr:'+nevent,npub='nostr:'+npub,nprofile='nostr:'+nprofile,naddr='nostr:'+address,deep=deep_uri)
    for name,uri in list(uris.items()):
        if name!='deep':add('ref_'+name,'参照の表示。'+uri)
    add('multiple',uris['note']+' '+uris['nprofile']+' '+uris['naddr'])
    missing='nostr:'+bech32('note',bytes.fromhex('f'*64))
    add('missing',missing)
    invalid=original_uri[:-1]+('p' if original_uri[-1]=='q' else 'q')
    add('invalidFirst',invalid+' '+uris['note'])
    add('image','画像 https://media.example/photo.JPG?size=1000')
    add('imeta','説明 https://media.example/no-extension',tags=[['imeta','url https://media.example/no-extension','m image/webp','dim 3000x1000','alt 青空の写真']])
    add('images','https://media.example/photo.JPG?size=1000 https://media.example/second.png https://media.example/third.gif')
    add('imageFailure','https://media.example/fail.png')
    add('youtube','動画 https://youtu.be/M7lc1UVf-VE')
    add('youtubeWatch','https://www.youtube.com/watch?v=M7lc1UVf-VE&feature=share')
    add('youtubeShorts','https://youtube.com/shorts/M7lc1UVf-VE')
    add('youtubeMultiple','https://youtu.be/M7lc1UVf-VE https://youtu.be/abcdefghijk')
    add('x','X https://x.com/alice/status/1234567890123456789')
    add('twitter','https://twitter.com/bob/status/1234567890123456789')
    add('xMultiple','https://x.com/alice/status/1234567890123456789 https://twitter.com/bob/status/987654321')
    e=[['e',original['id'],'wss://unconfigured.example'],['p',original['pubkey']]]
    add('repostJSON',json.dumps(original,ensure_ascii=False),6,e)
    add('repostEmpty','',6,e)
    add('repostMalformed','{bad json',6,e)
    add('repostMissing','',6,[['e','f'*64,'wss://unconfigured.example']])
    add('repostForged',json.dumps(dict(original,content='偽造された内容'),ensure_ascii=False),6,e)
    add('generic',json.dumps(article,ensure_ascii=False),16,[['a',coord],['k','30023']])
    add('genericEmpty','',16,[['a',coord],['k','30023']])
    inner=events['repostJSON']
    add('genericNested',json.dumps(inner,ensure_ascii=False),16,[['e',inner['id']],['k','6']])
    add('quote','引用コメント',tags=[['q',original['id']],['e',original['id']]])
    add('quoteAddress','記事を引用',tags=[['q',coord]])
    add('quoteReply','これは返信であり引用もある',tags=[['q',original['id']],['e',deep['id'],'','reply']])
    add('mixed',f"https://media.example/photo.JPG?size=1000 {uris['note']} https://x.com/a/status/1234567890123456789 https://youtu.be/M7lc1UVf-VE",tags=[['q',original['id']]])
    add('mixedNostrFirst',f"{uris['note']} https://media.example/photo.JPG?size=1000 https://x.com/a/status/1234567890123456789 https://youtu.be/M7lc1UVf-VE",tags=[['q',original['id']]])
    add('hostile','<script>window.__pwned=1</script> https://youtube.com.evil.example/watch?v=M7lc1UVf-VE javascript:alert(1) nostr:nsec1private')
    return dict(keys=keys,events=events,uris=uris,coordinate=coord,invalid=invalid)

if __name__=='__main__':
    path=Path(__file__).parent/'fixtures/rich-content.json'
    path.write_text(json.dumps(content_fixtures(),ensure_ascii=False,indent=2)+'\n')
    print(path)
