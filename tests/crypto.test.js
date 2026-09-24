import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifySchnorr,hexToBytes,verifyEvent,eventHash,validEventShape} from '../js/core/crypto.js';
const vectors=JSON.parse(fs.readFileSync(new URL('./fixtures/bip340.json',import.meta.url)));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
for(const [index,pubkey,msg,sig,valid] of vectors)test(`BIP-340 official verification vector ${index}`,async()=>assert.equal(await verifySchnorr(hexToBytes(msg),pubkey,sig),valid));
test('Independent OpenSSL/Python fixture: all signed Nostr kinds verify',async()=>{for(const event of fixture.events)assert.equal(await verifyEvent(event),true,event.id);});
test('Reject modified content, id, signature, author, tags and timestamp',async()=>{
 const e=fixture.events[0];for(const patch of [{content:e.content+' '},{id:'0'.repeat(64)},{sig:'0'.repeat(128)},{pubkey:fixture.keys.bob},{tags:[['p',fixture.keys.bob]]},{created_at:e.created_at+1}])assert.equal(await verifyEvent({...e,...patch}),false);
});
test('Strict event format rejects invalid scalar types and large bodies',async()=>{
 const e=fixture.events[0];for(const patch of [{kind:-1},{kind:65536},{kind:1.5},{created_at:'1'},{tags:[[1]]},{tags:[[]]},{content:null},{id:e.id.toUpperCase()},{content:'あ'.repeat(100000)}])assert.equal(await verifyEvent({...e,...patch}),false);
 assert.equal(validEventShape(null),false);assert.equal(await eventHash(e),e.id);
});
test('Malformed signatures and non-curve public keys never throw',async()=>{
 for(const [p,s]of [['x','y'],['00'.repeat(32),'ff'.repeat(64)],['ff'.repeat(32),'00'.repeat(64)]])assert.equal(await verifySchnorr(new Uint8Array(32),p,s),false);
 assert.throws(()=>hexToBytes('01x'));assert.throws(()=>hexToBytes('0'));
});
