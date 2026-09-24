import test from 'node:test';
import assert from 'node:assert/strict';
import {relayEntries,relayListTags,changeRelayTags} from '../js/profiles/relay-list.js';
import {Social} from '../js/social/service.js';
const owner='1'.repeat(64),other='2'.repeat(64);
const current={kind:10002,pubkey:owner,created_at:100,content:'keep',tags:[['r','wss://read.example/','read'],['r','wss://write.example/','write'],['x','keep'],['r','wss://future.example/','unknown','extension']]};
function harness(source=current,{incomplete=false}={}) {
 const calls=[],settings={value:{relays:['wss://configured.example/'],requestGapMs:0}},session={pubkey:owner};
 const repo={on(){},replacement:async(kind,key,opts)=>{calls.push({kind,key,opts});if(incomplete)throw Error('最新のデータを全リレーで確認できません');return kind===10002?source:null;}};
 const social=new Social(repo,session,settings,{},{});social.exclusive=async(kind,fn)=>fn(owner);
 const sent=[];social.publish=async event=>{sent.push(event);return {...event,pubkey:owner};};return {social,calls,sent,settings,session};
}
test('NIP-65 tags expose read/write modes and retain unknown markers',()=>{assert.deepEqual(relayEntries(current).map(r=>r.mode),['read','write','unknown']);});
test('Legacy contact-list relay flags migrate without changing follow tags',()=>{
 const old={tags:[['p',other]],content:JSON.stringify({'wss://a.example':{read:true,write:false},'wss://b.example':{read:false,write:true},'wss://c.example':{read:false,write:false}})};
 assert.deepEqual(relayListTags(null,old),[['r','wss://a.example/','read'],['r','wss://b.example/','write']]);assert.deepEqual(old.tags,[['p',other]]);
});
test('Adding one relay preserves all existing tags and chosen mode',()=>{
 const result=changeRelayTags(current.tags,{action:'add',url:'wss://NEW.example',mode:'write'});assert.equal(result.changed,true);assert.deepEqual(result.tags.slice(0,-1),current.tags);assert.deepEqual(result.tags.at(-1),['r','wss://new.example/','write']);
});
test('Normalized duplicate addition does not change the list',()=>{assert.equal(changeRelayTags(current.tags,{action:'add',url:'wss://READ.example'}).changed,false);});
test('Removal deletes only matching relay tags, preserves unknown/nonrelay tags',()=>{
 const result=changeRelayTags(current.tags,{action:'remove',url:'wss://READ.example'});assert.deepEqual(result.tags,current.tags.slice(1));
});
test('Invalid relay protocols, credentials, fragments and modes are rejected',()=>{
 for(const url of ['https://a.example','ws://a.example','wss://user:pw@a.example','wss://a.example/#x'])assert.throws(()=>changeRelayTags([],{action:'add',url}));
 assert.throws(()=>changeRelayTags([],{action:'add',url:'wss://a.example',mode:'unknown'}));
});
test('Only the logged-in owner can mutate public relay metadata',async()=>{const h=harness();await assert.rejects(h.social.changeRelay(other,{action:'remove',url:'wss://read.example'}),/自分/);assert.equal(h.calls.length,0);});
test('Read-modify-write fetches latest all-relay data, not a UI snapshot',async()=>{
 const h=harness();await h.social.changeRelay(owner,{action:'add',url:'wss://new.example/'});
 assert.deepEqual(h.calls[0],{kind:10002,key:owner,opts:{fresh:true,all:true,required:true}});assert.equal(h.sent[0].kind,10002);assert.equal(h.sent[0].content,'keep');assert.ok(h.sent[0].created_at>100);
});
test('Public relay changes never change local application relay settings',async()=>{
 const h=harness(),before=JSON.stringify(h.settings);await h.social.changeRelay(owner,{action:'remove',url:'wss://read.example/'});assert.equal(JSON.stringify(h.settings),before);
});
test('Incomplete preflight refuses to sign or replace a public relay list',async()=>{
 const h=harness(current,{incomplete:true});await assert.rejects(h.social.changeRelay(owner,{action:'add',url:'wss://new.example/'}));assert.equal(h.sent.length,0);
});
test('A duplicate addition and an absent deletion do not sign new events',async()=>{
 const h=harness();await h.social.changeRelay(owner,{action:'add',url:'wss://read.example/'});await h.social.changeRelay(owner,{action:'remove',url:'wss://absent.example/'});assert.equal(h.sent.length,0);
});
test('The last relay can be removed without falling back to app relay settings',async()=>{
 const h=harness({...current,tags:[['r','wss://last.example/']]});const r=await h.social.changeRelay(owner,{action:'remove',url:'wss://last.example/'});assert.deepEqual(r.entries,[]);assert.deepEqual(h.sent[0].tags,[]);
});
