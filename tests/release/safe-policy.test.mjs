import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface,keccak256} from 'ethers';
import {SAFE_STORAGE_SLOTS,assertSafeMatchesPolicy,assertSafeRoleBinding,inspectSafePolicy,loadBoundSafePolicy,validateSafePolicy} from '../../tooling/verification/verify-safe-policy.mjs';

const policy=JSON.parse(readFileSync(new URL('../../tooling/config/mainnet-safe-policy.json',import.meta.url),'utf8'));
const stage=policy.preDeployState;
const ABI=new Interface(['function getOwners() view returns(address[])','function getThreshold() view returns(uint256)','function VERSION() view returns(string)',
  'function nonce() view returns(uint256)','function getModulesPaginated(address,uint256) view returns(address[],address)']);
const word=address=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase(),block={number:'0x10',hash:'0x'+'ab'.repeat(32)};

function providerFixture(){
  const calls=[];return {calls,send:async(method,args)=>{calls.push([method,args]);
    if(method==='eth_chainId')return '0x1';if(method==='eth_getBlockByNumber')return block;
    if(method==='eth_getStorageAt'){
      if(args[1]==='0x0')return word(policy.singleton);
      if(args[1]===SAFE_STORAGE_SLOTS.fallbackHandler)return word(policy.fallbackHandler);
      if(args[1]===SAFE_STORAGE_SLOTS.guard)return word(policy.guard);
      if(args[1]===SAFE_STORAGE_SLOTS.moduleGuard)return word(policy.moduleGuard);
    }
    if(method==='eth_getCode'){
      const address=args[0].toLowerCase();
      if(address===policy.safe.toLowerCase())return '0x6001';if(address===policy.singleton.toLowerCase())return '0x6002';
      if(address===policy.fallbackHandler.toLowerCase())return '0x6003';if(address===stage.owners[0].address.toLowerCase())return '0x';
    }
    if(method==='eth_call'){
      const selector=args[0].data.slice(0,10),entry=ABI.fragments.find(fragment=>fragment.type==='function'&&ABI.getFunction(fragment.name).selector===selector);
      if(entry.name==='getOwners')return ABI.encodeFunctionResult(entry,[stage.owners.map(owner=>owner.address)]);
      if(entry.name==='getThreshold')return ABI.encodeFunctionResult(entry,[stage.threshold]);if(entry.name==='VERSION')return ABI.encodeFunctionResult(entry,[policy.version]);
      if(entry.name==='nonce')return ABI.encodeFunctionResult(entry,[0]);if(entry.name==='getModulesPaginated')return ABI.encodeFunctionResult(entry,[policy.modules,'0x0000000000000000000000000000000000000001']);
    }
    throw Error(`Unexpected RPC ${method} ${JSON.stringify(args)}`);
  }};
}

test('mainnet Safe policy records owner, treasury and royalty receiver',()=>{
  assert.doesNotThrow(()=>validateSafePolicy(policy));assert.deepEqual(policy.roles,['initialOwner','treasury','royaltyReceiver']);assert.equal(stage.threshold,1);assert.equal(stage.owners.length,1);
  assert.equal(stage.owners[0].codeHash,keccak256('0x'));assert.deepEqual(policy.modules,[]);
  assert.doesNotThrow(()=>assertSafeRoleBinding({initialOwner:policy.safe,treasury:policy.safe,royaltyReceiver:policy.safe,
    roleCodeHashes:{initialOwner:policy.proxyCodeHash,treasury:policy.proxyCodeHash,royaltyReceiver:policy.proxyCodeHash}},policy));
  assert.throws(()=>assertSafeRoleBinding({initialOwner:'0x1000000000000000000000000000000000000001',treasury:policy.safe,
    royaltyReceiver:policy.safe,roleCodeHashes:{initialOwner:policy.proxyCodeHash,treasury:policy.proxyCodeHash,royaltyReceiver:policy.proxyCodeHash}},policy),/initialOwner/);
});

test('release Safe policy loader accepts the exact source-bound policy',async()=>{
  assert.deepEqual(await loadBoundSafePolicy(new URL('../../tooling/config/mainnet-safe-policy.json',import.meta.url)),policy);
});

test('Safe policy verification is pinned to one canonical block and every control surface',async()=>{
  const fixture=providerFixture(),synthetic={...policy,proxyCodeHash:keccak256('0x6001'),singletonCodeHash:keccak256('0x6002'),fallbackHandlerCodeHash:keccak256('0x6003')};
  const report=await inspectSafePolicy({provider:fixture,policy:synthetic});assert.equal(report.nonce,'0');assert.equal(report.block.hash,block.hash);
  assert.ok(!fixture.calls.some(([method])=>/sendTransaction|sendRawTransaction/.test(method)));
  for(const patch of [{preDeployState:{...stage,threshold:2}},{preDeployState:{...stage,nonce:'1'}},{modules:[policy.singleton]},{guard:policy.singleton},{fallbackHandler:policy.singleton},{version:'1.4.1'}])
    assert.throws(()=>assertSafeMatchesPolicy(report,{...synthetic,...patch}));
});
