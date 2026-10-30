import test from 'node:test';
import assert from 'node:assert/strict';
import {getCreateAddress,keccak256} from 'ethers';
import {broadcastPreparedManifest,inspectBroadcastProgress,validateBroadcastManifest,validateMainnetBroadcastManifest} from '../../tooling/lib/broadcast-release.mjs';
import {releaseDigest} from '../../tooling/lib/release-binding.mjs';
import {deploymentAddresses} from '../../tooling/verification/verify-release.mjs';

const deployer='0x1000000000000000000000000000000000000001';
const runtimeA='0x6001600055';
const runtimeB='0x6002600055';
const initA='0x60006000';
const initB='0x60016000';

function fixture(){
  const nonce=7;
  const steps=[
    {name:'A',nonce,address:getCreateAddress({from:deployer,nonce}),initcode:initA,initcodeHash:keccak256(initA),runtimeHash:keccak256(runtimeA)},
    {name:'B',nonce:nonce+1,address:getCreateAddress({from:deployer,nonce:nonce+1}),initcode:initB,initcodeHash:keccak256(initB),runtimeHash:keccak256(runtimeB)}
  ];
  const payload={format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',config:{chainId:11155111,deployer,nonce,gasLimits:{A:'100000',B:'110000'},maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000'},steps,internalContracts:[],addresses:{A:steps[0].address,B:steps[1].address}};
  return {...payload,digest:releaseDigest(payload)};
}

function fakeNetwork(manifest,{predeployed=0,badRuntime=false,pendingDelta=0}={}){
  const code=new Map();
  if(predeployed>0)code.set(manifest.steps[0].address.toLowerCase(),badRuntime?'0x6009':runtimeA);
  if(predeployed>1)code.set(manifest.steps[1].address.toLowerCase(),runtimeB);
  let latest=BigInt(manifest.config.nonce+predeployed),pending=latest+BigInt(pendingDelta);
  const sent=[];
  const provider={send:async(method,args)=>{
    if(method==='eth_chainId')return '0xaa36a7';
    if(method==='eth_getBlockByNumber')return {number:'0x64',hash:'0x'+'11'.repeat(32),gasLimit:'0x1c9c380',baseFeePerGas:'0x3b9aca00'};
    if(method==='eth_getCode')return code.get(args[0].toLowerCase())||'0x';
    if(method==='eth_getTransactionCount')return '0x'+(args[1]==='pending'?pending:latest).toString(16);
    throw new Error(`Unexpected RPC ${method}`);
  }};
  const signer={getAddress:async()=>deployer,sendTransaction:async request=>{
    const index=Number(BigInt(request.nonce)-BigInt(manifest.config.nonce));
    const step=manifest.steps[index];
    sent.push(request);
    return {from:deployer,nonce:Number(request.nonce),data:request.data,hash:'0x'+'ab'.repeat(32),wait:async()=>{
      code.set(step.address.toLowerCase(),index===0?runtimeA:runtimeB);latest++;pending=latest;
      return {status:1,from:deployer,contractAddress:step.address,hash:'0x'+'cd'.repeat(32),blockNumber:100+index,
        blockHash:'0x'+'ef'.repeat(32),gasUsed:90000n,gasPrice:1500000000n};
    }};
  }};
  return {provider,signer,sent,code};
}

test('manifest-bound broadcaster sends exact approved initcode, nonces and fee caps and verifies runtime',async()=>{
  const manifest=fixture(),network=fakeNetwork(manifest);
  validateBroadcastManifest(manifest,manifest.digest);
  const result=await broadcastPreparedManifest({manifest,expectedDigest:manifest.digest,...network});
  assert.equal(result.status,'BROADCAST_COMPLETE_RUNTIME_VERIFIED');
  assert.deepEqual(result.receipts.map(r=>r.name),['A','B']);
  assert.equal(network.sent.length,2);
  assert.equal(network.sent[0].data,initA);assert.equal(network.sent[1].data,initB);
  assert.equal(network.sent[0].nonce,7);assert.equal(network.sent[1].nonce,8);
  assert.equal(network.sent[0].gasLimit,100000n);assert.equal(network.sent[1].gasLimit,110000n);
  assert.equal(network.sent[0].maxFeePerGas,2000000000n);assert.equal(network.sent[0].maxPriorityFeePerGas,1000000000n);
});

test('broadcaster resumes only from a contiguous prefix with approved runtime',async()=>{
  const manifest=fixture(),network=fakeNetwork(manifest,{predeployed:1});
  const progress=await inspectBroadcastProgress({manifest,provider:network.provider});
  assert.deepEqual(progress.completed,['A']);
  const result=await broadcastPreparedManifest({manifest,expectedDigest:manifest.digest,...network});
  assert.deepEqual(result.resumedAfter,['A']);assert.equal(network.sent.length,1);assert.equal(network.sent[0].nonce,8);
});

test('broadcaster fails closed on changed runtime or a pending nonce',async()=>{
  const manifest=fixture();
  await assert.rejects(()=>inspectBroadcastProgress({manifest,provider:fakeNetwork(manifest,{predeployed:1,badRuntime:true}).provider}),/runtime/);
  await assert.rejects(()=>inspectBroadcastProgress({manifest,provider:fakeNetwork(manifest,{pendingDelta:1}).provider}),/pending transaction/);
});

test('manifest validation rejects changed initcode even if the rest of the step is unchanged',()=>{
  const manifest=fixture();manifest.steps[0].initcode='0x01';
  assert.throws(()=>validateBroadcastManifest(manifest,manifest.digest));
});

test('release broadcaster is deliberately restricted to Sepolia',()=>{
  const manifest=fixture();manifest.config.chainId=1;manifest.digest=releaseDigest({...manifest,digest:undefined});
  assert.throws(()=>validateBroadcastManifest(manifest,manifest.digest),/chain 11155111/);
  assert.doesNotThrow(()=>validateMainnetBroadcastManifest(manifest,manifest.digest));
});

test('verified broadcast report is accepted as deployment address evidence',()=>{
  const manifest=fixture(),report={status:'BROADCAST_COMPLETE_RUNTIME_VERIFIED',releaseDigest:manifest.digest,
    chainId:manifest.config.chainId,deployer:manifest.config.deployer,addresses:manifest.addresses};
  assert.deepEqual(deploymentAddresses(report,manifest),manifest.addresses);
  assert.deepEqual(deploymentAddresses(manifest.addresses,manifest),manifest.addresses);
  const mainnet={...manifest,config:{...manifest.config,chainId:1}};
  assert.throws(()=>deploymentAddresses(mainnet.addresses,mainnet),/complete runtime-verified/);
  assert.throws(()=>deploymentAddresses({...report,releaseDigest:'0'.repeat(64)},manifest),/different release/);
});
