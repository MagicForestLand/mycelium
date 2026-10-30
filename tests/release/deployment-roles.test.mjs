import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoleAddresses,checkTreasuryReceiving} from '../../tooling/lib/deployment-roles.mjs';
import {ZeroAddress} from 'ethers';
const owner='0x1000000000000000000000000000000000000001';
const nft='0x2000000000000000000000000000000000000002';
const bank='0x3000000000000000000000000000000000000003';
const config={initialOwner:owner,treasury:owner,royaltyReceiver:owner};
test('all roles are explicit, never deployment modules; shared role wallets remain allowed',()=>{
  assert.equal(validateRoleAddresses(config,{MyceliumFriends:nft}).length,3);
  for(const role of Object.keys(config)){
    for(const value of [undefined,null,ZeroAddress,'bad',nft,bank])
      assert.throws(()=>validateRoleAddresses({...config,[role]:value},{MyceliumFriends:nft,Bank:bank}));
  }
  assert.throws(()=>validateRoleAddresses(config,{MyceliumFriends:nft,Bank:nft}),/collision/);
});
test('receiving probe is pinned, funded only by simulation and fails closed on unsupported RPC',async()=>{
  const calls=[];
  const provider={send:async(method,args)=>{calls.push([method,args]);if(method==='eth_getCode')return '0x6000';if(method==='eth_call')return '0x';throw Error(method);}};
  const options={provider,config,addresses:{MyceliumFriends:nft},blockTag:'0x10',amountWei:123n};
  const result=await checkTreasuryReceiving(options);
  assert.equal(result.roles.treasury.hasCode,true);assert.equal(result.treasuryProbe.passed,true);
  const call=calls.find(([method])=>method==='eth_call');
  assert.deepEqual(call[1],[{from:nft,to:owner,value:'0x7b',data:'0x',gas:'0xf4240'},'0x10',{[nft]:{balance:'0x7b'}}]);
  await assert.rejects(()=>checkTreasuryReceiving({...options,blockTag:'latest'}),/Pin/);
  await assert.rejects(()=>checkTreasuryReceiving({...options,amountWei:0n}),/positive/);
  await assert.rejects(()=>checkTreasuryReceiving({...options,provider:{send:async()=>{throw Error('overrides unsupported');}}}),/unsupported/);
});
