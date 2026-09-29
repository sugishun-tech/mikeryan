/** Invoked by transport_integration.py against its local, disposable relay only. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { RelayPool } from '../js/network/pool.js';
const {relay,auth,note,authors}=JSON.parse(fs.readFileSync(process.env.MIKERYAN_TRANSPORT_FIXTURE,'utf8'));
assert.match(relay,/^ws:\/\/127\.0\.0\.1:\d+\/$/);
const checks=[],values=new Map(),storage={get:async k=>values.get(k),set:async(k,v)=>{values.set(k,v);return true;},delete:async k=>{values.delete(k);return true;}};
const pool=new RelayPool(storage,{gap:0,timeout:2000});
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS:',name);};
try{
 check('Creating the production relay pool opens no unsolicited sockets',pool.connections.size===0);
 const profiles=await pool.query({relays:[relay],filters:[{kinds:[0],authors,limit:2}],gap:0});
 check('Native WebSocket reassembles fragmented JSON and verifies genuine profile signatures',profiles.complete&&profiles.events.length===2&&profiles.events.every(e=>e.kind===0));
 check('Duplicate signed events received over a real socket are deduplicated',new Set(profiles.events.map(e=>e.id)).size===2);
 const notes=await pool.query({relays:[relay],filters:[{kinds:[1],limit:3}],gap:0});
 check('A finite native request receives its page and closes after EOSE',notes.complete&&notes.events.length===3&&pool.stats().relays[0].closes===2);
 const response=await pool.publish({relays:[relay],event:note,gap:0});check('A signed fixture publication receives a real socket OK acknowledgement',response.accepted===1);
 const info=await pool.authInfo({relay});check('Native transport receives and binds the relay authentication challenge',info.challenge===auth.tags.find(t=>t[0]==='challenge')[1]);
 await pool.authenticate({relay,event:auth});check('Signed test NIP-42 authentication is accepted by the local relay',pool.stats().relays[0].publishes===2);
 const broken=await pool.query({relays:[relay],filters:[{kinds:[9999],limit:1}],gap:0});
 check('A real disconnect before EOSE is incomplete, not a confirmed empty page',broken.complete===false&&broken.errors.length===1);
 const count=pool.stats().relays[0].requests;await new Promise(r=>setTimeout(r,150));check('Disconnect never starts an automatic read or reconnect',pool.stats().relays[0].requests===count&&!pool.stats().relays[0].connected);
 console.log(JSON.stringify({suite:'local-native-websocket',passed:checks.length,checks,boundaries:'Node native WebSocket and production cryptographic verification; local Python relay; public test keys; no browser or public relay.'}));
}finally{await Promise.allSettled([...pool.connections.values()].map(c=>c.queue));pool.close();}
