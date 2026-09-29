"""Native Node WebSocket and signature integration, using a disposable localhost relay.
No public relay, real account, browser extension, or user key is accessed.
Run: python3 tests/transport_integration.py (requires Python websockets).
"""
import asyncio, json, os, tempfile, time
from pathlib import Path
import websockets
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]

def matches(event, filt):
    return (('kinds' not in filt or event['kind'] in filt['kinds']) and
            ('authors' not in filt or event['pubkey'] in filt['authors']))

async def main():
    data=fixtures();events=data['events'];frames=[]
    async def relay(ws):
        await ws.send(json.dumps(['AUTH','local-test-challenge']))
        async for raw in ws:
            message=json.loads(raw);frames.append(message)
            if message[0]=='REQ':
                if message[2].get('kinds')==[9999]:
                    await ws.close(code=1011,reason='test disconnect before EOSE');break
                selected={}
                for filt in message[2:]:
                    for event in sorted((e for e in events if matches(e,filt)),key=lambda e:(-e['created_at'],e['id']))[:filt['limit']]:selected[event['id']]=event
                for event in selected.values():
                    payload=json.dumps(['EVENT',message[1],event]);mid=len(payload)//2
                    await ws.send([payload[:mid],payload[mid:]])
                    await ws.send(payload)  # A duplicate wire frame must not duplicate the result.
                await ws.send(json.dumps(['EOSE',message[1]]))
            elif message[0] in ('EVENT','AUTH'):
                await ws.send(json.dumps(['OK',message[1]['id'],True,'']))
    async with websockets.serve(relay,'127.0.0.1',0) as server:
        url=f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/'
        auth=sign(dict(kind=22242,tags=[['relay',url],['challenge','local-test-challenge']],content='',created_at=int(time.time())))
        payload={'relay':url,'auth':auth,'note':next(e for e in events if e['kind']==1),'authors':[data['keys']['alice'],data['keys']['bob']]}
        with tempfile.TemporaryDirectory(prefix='mikeryan-transport-') as tmp:
            fixture=Path(tmp)/'fixture.json';fixture.write_text(json.dumps(payload))
            proc=await asyncio.create_subprocess_exec('node','tests/transport-integration.mjs',cwd=ROOT,env={**os.environ,'MIKERYAN_TRANSPORT_FIXTURE':str(fixture)},stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            try:out,err=await asyncio.wait_for(proc.communicate(),30)
            except asyncio.TimeoutError:proc.kill();await proc.wait();raise
            print(out.decode(),end='');print(err.decode(),end='')
            if proc.returncode:raise SystemExit(proc.returncode)
            result=json.loads(out.decode().splitlines()[-1]);result['wire_counts']={kind:sum(m[0]==kind for m in frames) for kind in ['REQ','CLOSE','EVENT','AUTH']}
            path=ROOT/'tests/output/transport-results.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(result,indent=2)+'\n')
            print('RESULT:',result['passed'],'local native transport checks passed')

if __name__=='__main__':asyncio.run(main())
