import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Interface,JsonRpcProvider,ZeroAddress,getAddress,keccak256,toQuantity} from 'ethers';

const HASH=/^0x[0-9a-f]{64}$/i,SENTINEL='0x0000000000000000000000000000000000000001';
export const SAFE_STORAGE_SLOTS=Object.freeze({
  fallbackHandler:'0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5',
  guard:'0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8',
  moduleGuard:'0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947'
});
const ABI=new Interface([
  'function getOwners() view returns(address[])','function getThreshold() view returns(uint256)',
  'function VERSION() view returns(string)','function nonce() view returns(uint256)',
  'function getModulesPaginated(address,uint256) view returns(address[],address)'
]);
const addressInWord=value=>getAddress('0x'+value.slice(-40));
const sortedAddresses=values=>values.map(getAddress).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));

export function validateSafePolicy(policy){
  assert.equal(policy?.format,1,'Unsupported Safe policy format');assert.equal(policy?.kind,'MYCELIUM_MAINNET_SAFE_POLICY','Invalid Safe policy kind');
  assert.equal(policy.chainId,1,'Safe policy must target Ethereum mainnet');getAddress(policy.safe);
  assert.deepEqual([...policy.roles].sort(),['initialOwner','treasury','royaltyReceiver'].sort(),'Safe policy roles must be initialOwner, treasury and royaltyReceiver');
  assert.equal(typeof policy.version,'string','Safe version required');
  for(const key of ['proxyCodeHash','singletonCodeHash','fallbackHandlerCodeHash'])assert.match(policy[key],HASH,`${key} must be a code hash`);
  for(const key of ['singleton','guard','moduleGuard','fallbackHandler'])getAddress(policy[key]);
  const stage=policy.preDeployState;assert.ok(stage&&typeof stage==='object','PRE_DEPLOY Safe state required');
  assert.ok(Array.isArray(stage.owners)&&stage.owners.length>0,'At least one PRE_DEPLOY Safe owner required');
  for(const owner of stage.owners){getAddress(owner.address);assert.match(owner.codeHash,HASH,'Owner code hash required');}
  assert.equal(new Set(stage.owners.map(owner=>getAddress(owner.address).toLowerCase())).size,stage.owners.length,'Duplicate Safe owner');
  assert.ok(Number.isSafeInteger(stage.threshold)&&stage.threshold>0&&stage.threshold<=stage.owners.length,'Invalid Safe threshold');
  assert.match(stage.nonce,/^(0|[1-9][0-9]*)$/,'Safe nonce must be a decimal integer string');
  assert.ok(Array.isArray(policy.modules),'Safe modules must be an array');policy.modules.forEach(getAddress);
  return policy;
}

export function assertSafeRoleBinding(config,policyInput){
  const policy=validateSafePolicy(policyInput),safe=getAddress(policy.safe);
  for(const role of policy.roles){
    assert.equal(getAddress(config[role]),safe,`${role} must use the reviewed Safe`);
    assert.equal(config.roleCodeHashes?.[role],policy.proxyCodeHash,`${role} code hash must match the reviewed Safe proxy`);
  }
  return policy;
}

export async function loadBoundSafePolicy(policyPath=new URL('../config/mainnet-safe-policy.json',import.meta.url)){
  const [candidate,bound]=await Promise.all([
    readFile(policyPath,'utf8').then(JSON.parse),
    readFile(new URL('../config/mainnet-safe-policy.json',import.meta.url),'utf8').then(JSON.parse)
  ]);
  assert.deepEqual(candidate,bound,'Supplied Safe policy differs from the release-bound mainnet policy');
  return validateSafePolicy(candidate);
}

async function call(provider,to,fragment,args,blockTag){
  const data=ABI.encodeFunctionData(fragment,args),result=await provider.send('eth_call',[{to,data},blockTag]);
  return ABI.decodeFunctionResult(fragment,result);
}

export async function inspectSafePolicy({provider,policy:policyInput}){
  const policy=validateSafePolicy(policyInput),safe=getAddress(policy.safe);
  assert.equal(BigInt(await provider.send('eth_chainId',[])),1n,'Safe verification RPC is not Ethereum mainnet');
  const block=await provider.send('eth_getBlockByNumber',['latest',false]);assert.ok(block?.number&&block.hash,'Safe verification block unavailable');
  const tag=block.number;
  const [proxyCode,singletonWord,fallbackWord,guardWord,moduleGuardWord,ownersResult,thresholdResult,versionResult,nonceResult,modulesResult]=await Promise.all([
    provider.send('eth_getCode',[safe,tag]),provider.send('eth_getStorageAt',[safe,toQuantity(0),tag]),
    provider.send('eth_getStorageAt',[safe,SAFE_STORAGE_SLOTS.fallbackHandler,tag]),provider.send('eth_getStorageAt',[safe,SAFE_STORAGE_SLOTS.guard,tag]),
    provider.send('eth_getStorageAt',[safe,SAFE_STORAGE_SLOTS.moduleGuard,tag]),call(provider,safe,'getOwners',[],tag),
    call(provider,safe,'getThreshold',[],tag),call(provider,safe,'VERSION',[],tag),call(provider,safe,'nonce',[],tag),
    call(provider,safe,'getModulesPaginated',[SENTINEL,100],tag)
  ]);
  assert.notEqual(proxyCode,'0x','Safe proxy has no code');assert.equal(getAddress(modulesResult[1]),getAddress(SENTINEL),'Safe has more than 100 modules; explicit pagination required');
  const singleton=addressInWord(singletonWord),fallbackHandler=addressInWord(fallbackWord),owners=ownersResult[0].map(getAddress),modules=modulesResult[0].map(getAddress);
  const [singletonCode,fallbackHandlerCode,...ownerCodes]=await Promise.all([
    provider.send('eth_getCode',[singleton,tag]),provider.send('eth_getCode',[fallbackHandler,tag]),...owners.map(owner=>provider.send('eth_getCode',[owner,tag]))
  ]);
  const canonical=await provider.send('eth_getBlockByNumber',[tag,false]);assert.equal(canonical?.hash?.toLowerCase(),block.hash.toLowerCase(),'Safe verification block was reorganized');
  const observed={chainId:1,block:{number:tag,hash:block.hash},safe,version:versionResult[0],proxyCodeHash:keccak256(proxyCode),singleton,
    singletonCodeHash:keccak256(singletonCode),owners:owners.map((address,index)=>({address,codeHash:keccak256(ownerCodes[index])})),
    threshold:Number(thresholdResult[0]),nonce:nonceResult[0].toString(),modules,guard:addressInWord(guardWord),moduleGuard:addressInWord(moduleGuardWord),
    fallbackHandler,fallbackHandlerCodeHash:keccak256(fallbackHandlerCode)};
  assertSafeMatchesPolicy(observed,policy);return observed;
}

export function assertSafeMatchesPolicy(observed,policyInput){
  const policy=validateSafePolicy(policyInput);
  for(const key of ['safe','singleton','guard','moduleGuard','fallbackHandler'])assert.equal(getAddress(observed[key]),getAddress(policy[key]),`Safe ${key} changed`);
  for(const key of ['version','proxyCodeHash','singletonCodeHash','fallbackHandlerCodeHash'])assert.equal(observed[key],policy[key],`Safe ${key} changed`);
  const stage=policy.preDeployState;
  assert.equal(observed.threshold,stage.threshold,'Safe PRE_DEPLOY threshold changed');
  assert.equal(observed.nonce,stage.nonce,'Safe PRE_DEPLOY nonce changed');
  assert.deepEqual(sortedAddresses(observed.modules),sortedAddresses(policy.modules),'Safe modules changed');
  const expectedOwners=new Map(stage.owners.map(owner=>[getAddress(owner.address),owner.codeHash]));
  assert.deepEqual(sortedAddresses(observed.owners.map(owner=>owner.address)),sortedAddresses([...expectedOwners.keys()]),'Safe owners changed');
  for(const owner of observed.owners)assert.equal(owner.codeHash,expectedOwners.get(getAddress(owner.address)),`Safe owner code changed: ${owner.address}`);
  assert.notEqual(getAddress(policy.fallbackHandler),ZeroAddress,'Safe fallback handler policy must be explicit');
  return observed;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [policyPath='tooling/config/mainnet-safe-policy.json']=process.argv.slice(2);assert.ok(process.env.RPC_URL,'Explicit RPC_URL required');
  const policy=JSON.parse(await readFile(policyPath,'utf8')),provider=new JsonRpcProvider(process.env.RPC_URL,1,{cacheTimeout:-1});
  try{const report=await inspectSafePolicy({provider,policy});console.log(JSON.stringify({status:'SAFE_POLICY_VERIFIED_READ_ONLY',...report},null,2));}
  finally{provider.destroy();}
}
