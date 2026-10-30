import test from 'node:test';
import assert from 'node:assert/strict';
import {mintProtection,verifyMintProtocol} from '../../../../tooling/lib/mint-protocol.mjs';
test('release verifier requires the approved domain, ages, batch limit, price step and empty initial commitment',async()=>{
  const values={COMMITMENT_DOMAIN:mintProtection.domain,MIN_COMMITMENT_AGE:60n,MAX_COMMITMENT_AGE:86400n,MAX_BATCH:32n,PRICE_STEP:100_000_000_000_000n,owner:'0x1111111111111111111111111111111111111111',commitments:0n};
  const mock=overrides=>Object.fromEntries(Object.entries({...values,...overrides}).map(([k,v])=>[k,async()=>v]));
  assert.equal(mintProtection.saleLifecycle,'phased-v1');
  assert.deepEqual(await verifyMintProtocol(mock({})),mintProtection);
  for(const [key,value] of Object.entries(values).filter(([k])=>k!=='owner'))await assert.rejects(()=>verifyMintProtocol(mock({[key]:typeof value==='bigint'?value+1n:'0x'+'00'.repeat(32)})));
});
