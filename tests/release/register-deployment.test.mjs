import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {inspectDeploymentFromRpc,publicDeploymentRecord,validateVerificationRpcUrls,verifyIndependentRpcConsensus} from '../../tooling/release/register-deployment.mjs';

const deployer='0x1111111111111111111111111111111111111111',owner='0x2222222222222222222222222222222222222222',address='0x3333333333333333333333333333333333333333';
const tx='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),runtimeHash='0x'+'c'.repeat(64);

function fixture(){
  const manifest={digest:'d'.repeat(64),source:{commit:'e'.repeat(40)},config:{chainId:1,deployer,initialOwner:owner,treasury:owner,royaltyReceiver:owner,royaltyBps:500,saleCap:1000},
    catalog:{sha256:'f'.repeat(64)},mintProtection:{protocol:'commit-reveal-v1',saleLifecycle:'phased-v1',minimumAgeSeconds:60,maximumAgeSeconds:86400},
    steps:[{name:'MyceliumFriends',address,runtimeHash}],internalContracts:[]};
  const evidence={status:'BROADCAST_COMPLETE_RUNTIME_VERIFIED',releaseDigest:manifest.digest,completedSteps:1,totalSteps:1,
    receipts:[{name:'MyceliumFriends',transactionHash:tx,blockNumber:100,blockHash,gasUsed:'90000',effectiveGasPrice:'1500000000'}],internalContracts:[]};
  const registration={id:'mycelium-friends-mainnet',label:'Mycelium Friends',networkName:'Ethereum',explorerUrl:'https://etherscan.io'};
  const receipt={status:1,from:deployer,contractAddress:address,hash:tx,blockNumber:100};
  const finalized={number:110,hash:'0x'+'1'.repeat(64)};
  const rpcConsensus={kind:'INDEPENDENT_RPC_CONSENSUS',providerCount:2,finalized,receipts:[{name:'MyceliumFriends',transactionHash:tx,
    from:deployer,contractAddress:address,blockNumber:100,blockHash,gasUsed:'90000',effectiveGasPrice:'1500000000',runtimeHash}]};
  return {manifest,evidence,registration,receipt,block:{number:100,hash:blockHash},finalized,runtimeHash,rpcConsensus};
}

test('registration creates a finalized current-release public record',()=>{
  const record=publicDeploymentRecord(fixture());
  assert.equal(record.kind,'MYCELIUM_VERIFIED_DEPLOYMENT');assert.equal(record.releaseStatus,'CURRENT_RELEASE');assert.equal(record.chainId,1);
  assert.equal(record.collection.address,address);assert.equal(record.deploymentHash,blockHash);assert.equal(record.finality.blockNumber,110);
  assert.equal(record.collection.name,'Mycelium Friends');assert.equal(record.collection.symbol,'MYFRIENDS');
  assert.equal(record.protocol.mint,'commit-reveal-v1');assert.equal(record.verification.finalized,true);
});

test('registration rejects incomplete, mismatched or unfinalized evidence',()=>{
  const base=fixture();
  for(const patch of [
    {evidence:{...base.evidence,status:'BROADCAST_IN_PROGRESS_RUNTIME_VERIFIED_PREFIX'}},
    {evidence:{...base.evidence,receipts:[]}},
    {receipt:{...base.receipt,contractAddress:owner}},
    {block:{...base.block,hash:'0x'+'0'.repeat(64)}},
    {finalized:{...base.finalized,number:99}},
    {rpcConsensus:{...base.rpcConsensus,providerCount:1}},
    {runtimeHash:'0x'+'0'.repeat(64)}
  ])assert.throws(()=>publicDeploymentRecord({...base,...patch}));
});

test('registration requires two distinct HTTPS verification RPC providers',()=>{
  assert.deepEqual(validateVerificationRpcUrls(['https://rpc-one.example/a','https://rpc-two.example/b']),['https://rpc-one.example/a','https://rpc-two.example/b']);
  for(const urls of [[],['https://same.example/a','https://same.example/b'],['http://rpc-one.example','https://rpc-two.example']])assert.throws(()=>validateVerificationRpcUrls(urls));
});

test('registration rejects reordered or duplicated receipt evidence before RPC inspection',async()=>{
  const base=fixture(),other={name:'Other',address:owner,runtimeHash:'0x'+'0'.repeat(64)};
  base.manifest.steps=[other,...base.manifest.steps];
  base.evidence.receipts=[base.evidence.receipts[0],{...base.evidence.receipts[0],name:'Other'}];
  await assert.rejects(()=>inspectDeploymentFromRpc({
    provider:{send:async method=>{if(method==='eth_chainId')return '0x1';throw Error(`Unexpected RPC: ${method}`);}},
    manifest:base.manifest,
    evidence:base.evidence
  }),/approved manifest order/);
  assert.throws(()=>publicDeploymentRecord({...base,evidence:{...base.evidence,completedSteps:2,totalSteps:2}}),/approved manifest order/);
});

test('independent RPC consensus covers every canonical finalized receipt and historical runtime',async()=>{
  const base=fixture(),finalizedHash='0x'+'1'.repeat(64);
  const provider=changedBlock=>({send:async(method,args)=>{
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:tx,from:deployer,contractAddress:address,blockNumber:'0x64',blockHash,
      gasUsed:'0x15f90',effectiveGasPrice:'0x59682f00'};
    if(method==='eth_getCode')return '0x6001';
    if(method==='eth_getBlockByNumber'){
      if(args[0]==='finalized')return {number:'0x6e',hash:finalizedHash};
      if(args[0]==='0x6e')return {number:'0x6e',hash:changedBlock?'0x'+'2'.repeat(64):finalizedHash};
      return {number:'0x64',hash:blockHash};
    }
    throw Error(method);
  }});
  base.manifest.steps[0].runtimeHash=keccak256('0x6001');base.runtimeHash=base.manifest.steps[0].runtimeHash;
  const inspected=await inspectDeploymentFromRpc({provider:provider(false),manifest:base.manifest,evidence:base.evidence});assert.equal(inspected.receipts.length,1);
  const consensus=await verifyIndependentRpcConsensus({providers:[provider(false),provider(false)],manifest:base.manifest,evidence:base.evidence});
  assert.equal(consensus.providerCount,2);assert.equal(consensus.finalized.number,110);
  await assert.rejects(()=>verifyIndependentRpcConsensus({providers:[provider(false),provider(true)],manifest:base.manifest,evidence:base.evidence}),/finalized chain/);
});
