import test from 'node:test';
import assert from 'node:assert/strict';
import {emitMintEvidence,newMintEvidenceId} from '../../../../apps/web/src/mint-telemetry.js';

test('mint evidence uses an opaque id and never invents location evidence',async()=>{
  assert.match(newMintEvidenceId(()=> '9d0871fb-e39a-49f0-a795-b84d924b12a2'),/^[a-f0-9-]{36}$/);
  const requests=[];
  const event={stage:'intent',evidenceId:'9d0871fb-e39a-49f0-a795-b84d924b12a2',wallet:'0x'+'1'.repeat(40),chainId:1};
  assert.equal(await emitMintEvidence('https://magicforest.land/api/mycelium/mint-events',event,{fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true};}}),true);
  const sent=JSON.parse(requests[0].options.body);
  assert.deepEqual(sent,event);
  assert.equal(Object.hasOwn(sent,'country'),false);
  assert.equal(Object.hasOwn(sent,'ip'),false);
  assert.equal(requests[0].options.credentials,'omit');
  assert.equal(requests[0].options.keepalive,true);
});

test('mint evidence is serialized by id and failures never reject the mint flow',async()=>{
  const order=[];
  let release;
  const fetchImpl=async(_url,{body})=>{
    const stage=JSON.parse(body).stage;order.push(`start:${stage}`);
    if(stage==='intent')await new Promise(resolve=>{release=resolve;});
    order.push(`end:${stage}`);return {ok:true};
  };
  const base={evidenceId:'mint-evidence-123456'};
  const first=emitMintEvidence('https://example.test/evidence',{...base,stage:'intent'},{fetchImpl});
  const second=emitMintEvidence('https://example.test/evidence',{...base,stage:'submitted'},{fetchImpl});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(order,['start:intent']);
  release();await Promise.all([first,second]);
  assert.deepEqual(order,['start:intent','end:intent','start:submitted','end:submitted']);
  assert.equal(await emitMintEvidence('https://example.test/evidence',{...base,stage:'confirmed'},{fetchImpl:async()=>{throw Error('offline');}}),false);
});

test('mint evidence refuses unsafe endpoints and malformed stages',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return {ok:true};};
  assert.equal(await emitMintEvidence('http://example.test/evidence',{stage:'intent',evidenceId:'mint-evidence-123456'},{fetchImpl}),false);
  assert.equal(await emitMintEvidence('https://example.test/evidence',{stage:'country',evidenceId:'mint-evidence-123456'},{fetchImpl}),false);
  assert.equal(calls,0);
});
