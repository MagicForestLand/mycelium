import assert from 'node:assert/strict';
import {
  getAddress,
  getCreateAddress,
  keccak256
} from 'ethers';
import {MAX_TRANSACTION_GAS_LIMIT,assertApprovedDigest,sourceIdentity,verifyProductionInputs} from './release-binding.mjs';
import {inspectProductionNetwork} from '../verification/release-preflight.mjs';
import {checkTreasuryReceiving} from './deployment-roles.mjs';

const normalizedAddress=value=>getAddress(value);
const asBigInt=value=>typeof value==='bigint'?value:BigInt(value);
const codeHash=code=>keccak256(code);
const SEPOLIA_CHAIN_ID=11155111;
const MAINNET_CHAIN_ID=1;

export function validateBroadcastManifestForChain(manifest,expectedDigest,requiredChainId){
  assertApprovedDigest(manifest,expectedDigest);
  const {config,steps}=manifest;
  assert.ok([MAINNET_CHAIN_ID,SEPOLIA_CHAIN_ID].includes(requiredChainId),'Unsupported release broadcast target');
  assert.equal(config.chainId,requiredChainId,`Release manifest must target chain ${requiredChainId}`);
  assert.ok(Array.isArray(steps)&&steps.length>0,'Manifest has no deployment steps');
  assert.equal(steps.length,Object.keys(config.gasLimits||{}).length,'Gas limit coverage differs from deployment steps');
  for(const [index,step] of steps.entries()){
    const nonce=config.nonce+index;
    assert.equal(step.nonce,nonce,`${step.name}: manifest nonce is not sequential`);
    assert.equal(normalizedAddress(step.address),normalizedAddress(getCreateAddress({from:config.deployer,nonce})),`${step.name}: predicted address mismatch`);
    assert.ok(typeof step.initcode==='string'&&step.initcode.startsWith('0x')&&step.initcode.length>2,`${step.name}: missing initcode`);
    assert.equal(keccak256(step.initcode),step.initcodeHash,`${step.name}: initcode hash mismatch`);
    assert.match(step.runtimeHash,/^0x[0-9a-fA-F]{64}$/,`${step.name}: invalid runtime hash`);
    assert.ok(Object.hasOwn(config.gasLimits,step.name),`${step.name}: missing approved gas limit`);
    assert.ok(BigInt(config.gasLimits[step.name])<=MAX_TRANSACTION_GAS_LIMIT,`${step.name}: gas limit exceeds the EIP-7825 transaction cap`);
  }
  return manifest;
}

export const validateBroadcastManifest=(manifest,expectedDigest)=>validateBroadcastManifestForChain(manifest,expectedDigest,SEPOLIA_CHAIN_ID);
export const validateMainnetBroadcastManifest=(manifest,expectedDigest)=>validateBroadcastManifestForChain(manifest,expectedDigest,MAINNET_CHAIN_ID);

async function rpcNonce(provider,address,tag){
  return asBigInt(await provider.send('eth_getTransactionCount',[address,tag]));
}

export async function inspectBroadcastProgress({manifest,provider}){
  const completed=[];
  let foundGap=false;
  for(const step of manifest.steps){
    const code=await provider.send('eth_getCode',[step.address,'latest']);
    if(code==='0x'){
      foundGap=true;
      continue;
    }
    assert.equal(codeHash(code),step.runtimeHash,`${step.name}: existing code differs from approved runtime`);
    assert.ok(!foundGap,`${step.name}: deployment gap detected; later address has code before an earlier step`);
    completed.push(step.name);
  }
  const expectedNonce=BigInt(manifest.config.nonce+completed.length);
  const latest=await rpcNonce(provider,manifest.config.deployer,'latest');
  const pending=await rpcNonce(provider,manifest.config.deployer,'pending');
  assert.equal(latest,expectedNonce,`Deployer latest nonce ${latest} does not match resumable release nonce ${expectedNonce}`);
  assert.equal(pending,expectedNonce,`Deployer has a pending transaction at/after release nonce ${expectedNonce}; resolve it before broadcasting`);
  return {completed,completedCount:completed.length,nextNonce:expectedNonce};
}

async function verifyRuntime(provider,item,blockTag='latest'){
  const code=await provider.send('eth_getCode',[item.address,blockTag]);
  assert.notEqual(code,'0x',`${item.name}: no deployed code at expected address`);
  const actual=codeHash(code);
  assert.equal(actual,item.runtimeHash,`${item.name}: deployed runtime hash mismatch`);
  return actual;
}

async function currentBlock(provider){
  const block=await provider.send('eth_getBlockByNumber',['latest',false]);
  assert.ok(block?.hash&&block.number,'Missing latest block');
  assert.ok(block.baseFeePerGas!==undefined,'EIP-1559 fee data required');
  return block;
}

async function assertFeeWithinCap(provider,config){
  const block=await currentBlock(provider);
  const maxFee=BigInt(config.maxFeePerGas),priority=BigInt(config.maxPriorityFeePerGas);
  assert.ok(BigInt(block.baseFeePerGas)+priority<=maxFee,'Approved fee cap is below current base fee plus priority');
  return block;
}

export async function inspectResumeNetwork({manifest,provider,progress}){
  const {config}=manifest;
  assert.ok(progress.completedCount>0&&progress.completedCount<manifest.steps.length,'Resume inspection requires a partial deployment');
  assert.equal(asBigInt(await provider.send('eth_chainId',[])),BigInt(config.chainId),'Wrong chainId');
  const block=await assertFeeWithinCap(provider,config);
  for(const step of manifest.steps.slice(progress.completedCount)){
    assert.ok(BigInt(config.gasLimits[step.name])<=MAX_TRANSACTION_GAS_LIMIT,`${step.name}: gas limit exceeds the EIP-7825 transaction cap`);
    assert.ok(BigInt(config.gasLimits[step.name])<=BigInt(block.gasLimit),`${step.name}: gas limit exceeds current block limit`);
    assert.equal(await provider.send('eth_getCode',[step.address,block.number]),'0x',`Remaining address already has code: ${step.name}`);
  }
  const descriptorDone=progress.completed.includes('GenotypeDescriptor');
  for(const item of manifest.internalContracts||[]){
    const code=await provider.send('eth_getCode',[item.address,block.number]);
    if(descriptorDone){
      assert.notEqual(code,'0x',`${item.name}: internal contract missing during resume`);
      assert.equal(codeHash(code),item.runtimeHash,`${item.name}: internal runtime changed during resume`);
    }else assert.equal(code,'0x',`${item.name}: internal address occupied before GenotypeDescriptor deployment`);
  }
  const remainingGas=manifest.steps.slice(progress.completedCount).reduce((sum,step)=>sum+BigInt(config.gasLimits[step.name]),0n);
  const maximumFeeWei=remainingGas*BigInt(config.maxFeePerGas);
  const requiredBalanceWei=maximumFeeWei+BigInt(config.balanceBufferWei);
  const balance=BigInt(await provider.send('eth_getBalance',[config.deployer,block.number]));
  assert.ok(balance>=requiredBalanceWei,'Insufficient deployer balance for remaining approved maximum fee budget plus buffer');
  const addresses={...manifest.addresses,...Object.fromEntries((manifest.internalContracts||[]).map(c=>[c.name,c.address]))};
  const roles=await checkTreasuryReceiving({provider,config,addresses,blockTag:block.number,amountWei:BigInt(config.treasuryProbeWei)});
  for(const [role,details] of Object.entries(roles.roles))assert.equal(details.codeHash,config.roleCodeHashes[role],`Code changed for ${role}`);
  assert.equal(await rpcNonce(provider,config.deployer,'latest'),progress.nextNonce,'Deployer latest nonce changed during resume preflight');
  assert.equal(await rpcNonce(provider,config.deployer,'pending'),progress.nextNonce,'Unexpected pending transaction during resume preflight');
  assert.equal((await provider.send('eth_getBlockByNumber',[block.number,false]))?.hash,block.hash,'Resume preflight block was reorganized');
  return {block,remainingGas,maximumFeeWei,requiredBalanceWei,roles};
}

export async function broadcastPreparedManifest({manifest,expectedDigest,provider,signer,confirmations=1,onProgress=()=>{},validateManifest=validateBroadcastManifest}){
  validateManifest(manifest,expectedDigest);
  const sender=normalizedAddress(await signer.getAddress());
  assert.equal(sender,normalizedAddress(manifest.config.deployer),'Signer differs from approved deployer');
  assert.equal(asBigInt(await provider.send('eth_chainId',[])),BigInt(manifest.config.chainId),'Wrong chainId');

  const progress=await inspectBroadcastProgress({manifest,provider});
  const receipts=[];
  for(let index=progress.completedCount;index<manifest.steps.length;index++){
    const step=manifest.steps[index];
    const nonce=manifest.config.nonce+index;
    onProgress({phase:'before-send',index,total:manifest.steps.length,step,nonce});
    assert.equal(await provider.send('eth_getCode',[step.address,'latest']),'0x',`${step.name}: expected address became occupied`);
    assert.equal(await rpcNonce(provider,sender,'latest'),BigInt(nonce),`${step.name}: latest nonce changed before send`);
    assert.equal(await rpcNonce(provider,sender,'pending'),BigInt(nonce),`${step.name}: pending nonce changed before send`);
    await assertFeeWithinCap(provider,manifest.config);

    const request={
      data:step.initcode,
      nonce,
      gasLimit:BigInt(manifest.config.gasLimits[step.name]),
      maxFeePerGas:BigInt(manifest.config.maxFeePerGas),
      maxPriorityFeePerGas:BigInt(manifest.config.maxPriorityFeePerGas),
      type:2
    };
    const tx=await signer.sendTransaction(request);
    assert.equal(normalizedAddress(tx.from),sender,`${step.name}: transaction sender mismatch`);
    assert.equal(Number(tx.nonce),nonce,`${step.name}: signed nonce mismatch`);
    assert.equal(keccak256(tx.data),step.initcodeHash,`${step.name}: signed initcode differs from manifest`);
    onProgress({phase:'sent',index,total:manifest.steps.length,step,nonce,hash:tx.hash});

    const receipt=await tx.wait(confirmations);
    assert.ok(receipt,`${step.name}: missing transaction receipt`);
    assert.equal(Number(receipt.status),1,`${step.name}: deployment transaction reverted`);
    assert.equal(normalizedAddress(receipt.from),sender,`${step.name}: receipt sender mismatch`);
    assert.equal(normalizedAddress(receipt.contractAddress),normalizedAddress(step.address),`${step.name}: receipt contract address mismatch`);
    const runtimeHash=await verifyRuntime(provider,step,'latest');
    const nextNonce=BigInt(nonce+1);
    assert.equal(await rpcNonce(provider,sender,'latest'),nextNonce,`${step.name}: latest nonce did not advance exactly once`);
    assert.equal(await rpcNonce(provider,sender,'pending'),nextNonce,`${step.name}: unexpected pending transaction detected after deployment`);
    assert.ok(receipt.gasPrice!==null&&receipt.gasPrice!==undefined,`${step.name}: receipt is missing effective gas price`);
    const record={name:step.name,address:step.address,nonce,transactionHash:receipt.hash||tx.hash,blockNumber:receipt.blockNumber,
      blockHash:receipt.blockHash,gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.gasPrice.toString(),runtimeHash};
    receipts.push(record);
    onProgress({phase:'verified',index,total:manifest.steps.length,step,nonce,record});
  }

  const internalContracts=[];
  for(const item of manifest.internalContracts||[]){
    internalContracts.push({name:item.name,address:item.address,runtimeHash:await verifyRuntime(provider,item,'latest')});
  }
  return {
    status:'BROADCAST_COMPLETE_RUNTIME_VERIFIED',
    releaseDigest:manifest.digest,
    chainId:manifest.config.chainId,
    deployer:sender,
    resumedAfter:progress.completed,
    receipts,
    addresses:manifest.addresses,
    internalContracts
  };
}

export async function broadcastProductionRelease({manifest,expectedDigest,provider,signer,confirmations=1,onProgress}){
  await verifyProductionInputs(manifest,expectedDigest);
  validateBroadcastManifest(manifest,expectedDigest);
  const progress=await inspectBroadcastProgress({manifest,provider});
  if(progress.completedCount===0){
    // Fresh deployment: run the full read-only network/role/fee preflight immediately before the first transaction.
    await inspectProductionNetwork({manifest,provider,deployer:manifest.config.deployer});
  }else if(progress.completedCount<manifest.steps.length){
    // Interrupted deployment: existing steps must be the exact approved prefix, then re-check roles, fees and remaining balance.
    await inspectResumeNetwork({manifest,provider,progress});
  }
  const result=await broadcastPreparedManifest({manifest,expectedDigest,provider,signer,confirmations,onProgress});
  assert.deepEqual(sourceIdentity(),manifest.source,'Sources changed during broadcast');
  return result;
}
