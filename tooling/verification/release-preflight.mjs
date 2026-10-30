import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,getAddress,toQuantity,formatEther,keccak256} from 'ethers';
import {MAX_TRANSACTION_GAS_LIMIT,verifyProductionInputs,sourceIdentity} from '../lib/release-binding.mjs';
import {checkTreasuryReceiving} from '../lib/deployment-roles.mjs';
import {assertSafeRoleBinding,inspectSafePolicy,loadBoundSafePolicy} from './verify-safe-policy.mjs';
const EMPTY_CODE_HASH=keccak256('0x');

// Only reads JSON-RPC state and simulates eth_call; this module has no signer or broadcast path.
export async function inspectProductionNetwork({manifest,provider,deployer,safePolicy}){
  const {config}=manifest;
  assert.equal(getAddress(deployer),getAddress(config.deployer),'Selected deployer differs from approved deployer');
  let safeControl;
  if(safePolicy){assertSafeRoleBinding(config,safePolicy);safeControl=await inspectSafePolicy({provider,policy:safePolicy});}
  assert.equal(BigInt(await provider.send('eth_chainId',[])),BigInt(config.chainId),'Wrong chainId');
  const block=await provider.send('eth_getBlockByNumber',['latest',false]);assert.ok(block?.hash&&block.number,'Missing latest block');
  const checkNonce=async()=>{
    for(const tag of ['latest','pending'])assert.equal(BigInt(await provider.send('eth_getTransactionCount',[deployer,tag])),BigInt(config.nonce),`Deployer ${tag} nonce changed`);
  };
  await checkNonce();
  for(const item of [...manifest.steps,...manifest.internalContracts]){
    assert.equal(await provider.send('eth_getCode',[item.address,block.number]),'0x',`Address already has code: ${item.name}`);
    assert.equal(BigInt(await provider.send('eth_getTransactionCount',[item.address,block.number])),0n,`Address has nonzero nonce: ${item.name}`);
  }
  let gasBudget=0n;
  for(const step of manifest.steps){
    const gas=BigInt(config.gasLimits[step.name]);
    assert.ok(gas<=MAX_TRANSACTION_GAS_LIMIT,`${step.name}: gas limit exceeds the EIP-7825 transaction cap`);
    assert.ok(gas<=BigInt(block.gasLimit),`${step.name}: gas limit exceeds current block limit`);gasBudget+=gas;
  }
  const maxFee=BigInt(config.maxFeePerGas),priority=BigInt(config.maxPriorityFeePerGas);
  assert.ok(block.baseFeePerGas!==undefined,'EIP-1559 fee data required');
  assert.ok(BigInt(block.baseFeePerGas)+priority<=maxFee,'Approved fee cap is below current base fee plus priority');
  const balance=BigInt(await provider.send('eth_getBalance',[deployer,block.number]));
  const maximumFeeWei=gasBudget*maxFee,requiredBalanceWei=maximumFeeWei+BigInt(config.balanceBufferWei);
  assert.ok(balance>=requiredBalanceWei,'Insufficient deployer balance for approved maximum fee budget plus buffer');
  const addresses={...manifest.addresses,...Object.fromEntries(manifest.internalContracts.map(c=>[c.name,c.address]))};
  const roles=await checkTreasuryReceiving({provider,config,addresses,blockTag:block.number,amountWei:BigInt(config.treasuryProbeWei)});
  for(const [role,details] of Object.entries(roles.roles))assert.equal(details.codeHash,config.roleCodeHashes[role],`Code changed for ${role}`);
  await checkNonce();
  assert.equal((await provider.send('eth_getBlockByNumber',[block.number,false]))?.hash,block.hash,'Preflight block was reorganized');
  return {status:'PREFLIGHT_PASSED_NOT_BROADCAST',releaseDigest:manifest.digest,chainId:config.chainId,deployer:getAddress(deployer),nonce:config.nonce,
    block:{number:block.number,hash:block.hash},balanceWei:balance.toString(),gasBudget:gasBudget.toString(),maximumFeeWei:maximumFeeWei.toString(),
    requiredBalanceWei:requiredBalanceWei.toString(),feePolicy:{maxFeePerGas:config.maxFeePerGas,maxPriorityFeePerGas:config.maxPriorityFeePerGas},
    ...roles,safeControl,config,source:manifest.source,compiler:manifest.compiler,compilerSettings:manifest.compilerSettings,catalog:manifest.catalog,
    steps:manifest.steps.map(({name,address,nonce,initcodeHash,runtimeHash,resolvedArgs,dependencies})=>({name,address,nonce,initcodeHash,runtimeHash,resolvedArgs,dependencies})),
    internalContracts:manifest.internalContracts.map(({name,address,runtimeHash})=>({name,address,runtimeHash})),
    limitations:['Gas limits are approved budgets, not measured target-fork estimates; rehearse deployment on the actual target fork before broadcast.',
      'This report is a snapshot, not a broadcast authorization. Rerun immediately before a separately approved broadcast.',
      'Role code hashes do not attest wallet control or proxy storage/implementation policy. Independently review those.',
      'Explorer verification and marketplace metadata acceptance remain deployment-time requirements.']};
}

export async function preflightRelease({manifest,expectedDigest,provider,deployer,safePolicy}){
  await verifyProductionInputs(manifest,expectedDigest);
  const report=await inspectProductionNetwork({manifest,provider,deployer,safePolicy});
  assert.deepEqual(sourceIdentity(),manifest.source,'Sources changed during preflight');
  return report;
}

export function preflightText(report){
  return [
    `PRODUCTION PREFLIGHT: ${report.status} (no transactions sent)`,
    `Release: ${report.releaseDigest}`,
    `Chain: ${report.chainId}; block: ${report.block.number} / ${report.block.hash}`,
    `Deployer: ${report.deployer}; nonce: ${report.nonce}; balance: ${formatEther(report.balanceWei)} ETH`,
    ...Object.entries(report.roles).map(([role,value])=>`${role}: ${value.address}; codehash: ${value.codeHash}`),
    ...(report.safeControl?[`Safe control: ${report.safeControl.safe}; version ${report.safeControl.version}; threshold ${report.safeControl.threshold}/${report.safeControl.owners.length}; nonce ${report.safeControl.nonce}`]:[]),
    `Shared roles: ${JSON.stringify(report.sharedRoles)}`,
    `Royalties: ${report.config.royaltyBps} bps; saleCap: ${report.config.saleCap}`,
    `Traits: ${report.catalog.counts.join('/')}; combinations: ${report.catalog.genotypeSpace}`,
    `Git: ${report.source.commit}; tree: ${report.source.tree}; dirty policy: ${report.source.dirtyPolicy}`,
    `Compiler: ${report.compiler}; settings: ${JSON.stringify(report.compilerSettings)}`,
    `Gas budget: ${report.gasBudget}; maximum fees: ${formatEther(report.maximumFeeWei)} ETH (not an exact cost quote)`,
    ...report.steps.map(s=>`${s.name}: ${s.address}; nonce ${s.nonce}; runtime ${s.runtimeHash}; initcode ${s.initcodeHash}`),
    ...report.internalContracts.map(s=>`${s.name} (internal CREATE): ${s.address}; runtime ${s.runtimeHash}`),
    ...report.limitations.map(s=>`REQUIRED FOLLOW-UP: ${s}`)
  ].join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [manifestPath,...rest]=process.argv.slice(2),take=flag=>{const index=rest.indexOf(flag);return index<0?undefined:rest[index+1];};
  const expectedDigest=take('--expected-release'),deployer=take('--deployer'),reportPath=take('--report'),safePolicyPath=take('--safe-policy');
  assert.ok(manifestPath&&expectedDigest&&deployer&&reportPath,
    'Usage: RPC_URL=... node tooling/verification/release-preflight.mjs manifest.json --expected-release SHA256 --deployer ADDRESS --report report.json');
  assert.ok(process.env.RPC_URL,'Explicit RPC_URL required');
  const provider=new JsonRpcProvider(process.env.RPC_URL,undefined,{cacheTimeout:-1});
  try{
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    const contractOwner=manifest.config.chainId===1&&manifest.config.roleCodeHashes.initialOwner!==EMPTY_CODE_HASH;
    const safePolicy=contractOwner?await loadBoundSafePolicy(safePolicyPath):undefined;
    const report=await preflightRelease({manifest,expectedDigest,provider,deployer,safePolicy});
    // Keep generated reports outside the clean source repository.
    const {assertExternalOutput}=await import('../lib/release-paths.mjs');assertExternalOutput(reportPath);
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(preflightText(report));
  }finally{provider.destroy();}
}
