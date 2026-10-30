import test from 'node:test';
import assert from 'node:assert/strict';
import {allowlistPlan} from '../../tooling/release/prepare-allowlist.mjs';
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const config={chainId:11155111,collection:address(1000),saleCap:1000,allowlist:[address(1)]};
test('Allowlist calldata is fixed free, uses absolute quotas and keeps phase openings separate',()=>{
  const plan=allowlistPlan(config);
  assert.equal(plan.allowlist[0].allocation,1);
  assert.equal(plan.transactions.length,1);assert.equal(plan.transactions[0].method,'setAllowlistAllocations');
  assert.equal(plan.transactions.some(t=>['startAllowlistSale','openPublicSale','setPrivatePrice'].includes(t.method)),false);
  assert.equal(plan.allowlistOpening.transaction.method,'startAllowlistSale');assert.equal(plan.publicOpening.transaction.method,'openPublicSale');
  assert.throws(()=>allowlistPlan({...config,privatePriceETH:'0'}),/privatePriceETH is obsolete/);
  const large=allowlistPlan({...config,saleCap:100,allowlist:Array.from({length:201},(_,i)=>address(i+1))});
  assert.equal(large.transactions.length,3);assert.equal(large.warnings.length,3);
});
test('Allowlist calldata rejects ambiguous duplicates, bad addresses, quotas and obsolete price config',()=>{
  for(const patch of [{allowlist:[address(1),address(1)]},{allowlist:[address(0)]},{allowlist:[]},{chainId:0},{collection:address(0)},{privatePriceETH:'-1'},{donors:[address(1)]},
    ...[-1,0.5,1001].map(allocation=>({allowlist:[{wallet:address(1),allocation}]}))])assert.throws(()=>allowlistPlan({...config,...patch}));
});
