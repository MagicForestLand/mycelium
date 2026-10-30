import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,getAddress,keccak256} from 'ethers';
import {verifyRelease} from '../verification/verify-release.mjs';

const quantity=value=>BigInt(value),HASH=/^0x[0-9a-f]{64}$/i;

export function validateVerificationRpcUrls(values){
  assert.ok(Array.isArray(values)&&values.length===2,'Exactly two independent verification RPC URLs required');
  const urls=values.map(value=>new URL(value));
  for(const url of urls){assert.equal(url.protocol,'https:','Verification RPC must use HTTPS');assert.equal(url.username,'','RPC URL must not contain basic-auth credentials');assert.equal(url.password,'','RPC URL must not contain basic-auth credentials');}
  assert.notEqual(urls[0].hostname.toLowerCase(),urls[1].hostname.toLowerCase(),'Verification RPCs must use different providers/hostnames');
  return urls.map(url=>url.toString());
}

export async function inspectDeploymentFromRpc({provider,manifest,evidence}){
  assert.equal(quantity(await provider.send('eth_chainId',[])),1n,'Verification RPC is not Ethereum mainnet');
  assert.deepEqual(evidence.receipts?.map(item=>item.name),manifest.steps.map(step=>step.name),'Deployment receipts must exactly follow the approved manifest order');
  const finalized=await provider.send('eth_getBlockByNumber',['finalized',false]);
  assert.ok(finalized?.hash&&finalized.number,'Verification RPC has no finalized block');assert.match(finalized.hash,HASH,'Invalid finalized block hash');
  const finalizedNumber=Number(quantity(finalized.number)),receipts=[];
  for(const item of evidence.receipts){
    const step=manifest.steps.find(candidate=>candidate.name===item.name);assert.ok(step,`Unknown receipt step: ${item.name}`);
    const receipt=await provider.send('eth_getTransactionReceipt',[item.transactionHash]);assert.ok(receipt,`${item.name}: receipt unavailable`);
    assert.equal(quantity(receipt.status),1n,`${item.name}: transaction reverted`);
    assert.equal(receipt.transactionHash.toLowerCase(),item.transactionHash.toLowerCase(),`${item.name}: transaction hash mismatch`);
    assert.equal(getAddress(receipt.from),getAddress(manifest.config.deployer),`${item.name}: sender mismatch`);
    assert.equal(getAddress(receipt.contractAddress),getAddress(step.address),`${item.name}: contract address mismatch`);
    const blockNumber=Number(quantity(receipt.blockNumber));assert.equal(blockNumber,item.blockNumber,`${item.name}: block number mismatch`);
    assert.equal(receipt.blockHash.toLowerCase(),item.blockHash.toLowerCase(),`${item.name}: receipt block hash mismatch`);
    assert.equal(quantity(receipt.gasUsed).toString(),item.gasUsed,`${item.name}: receipt gas used mismatch`);
    assert.equal(quantity(receipt.effectiveGasPrice).toString(),item.effectiveGasPrice,`${item.name}: effective gas price mismatch`);
    assert.ok(finalizedNumber>=blockNumber,`${item.name}: receipt is not finalized`);
    const block=await provider.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
    assert.equal(block?.hash?.toLowerCase(),item.blockHash.toLowerCase(),`${item.name}: receipt block is noncanonical`);
    const runtimeHash=keccak256(await provider.send('eth_getCode',[step.address,receipt.blockNumber]));
    assert.equal(runtimeHash,step.runtimeHash,`${item.name}: historical runtime mismatch`);
    receipts.push({name:item.name,transactionHash:item.transactionHash,from:getAddress(receipt.from),contractAddress:getAddress(receipt.contractAddress),
      blockNumber,blockHash:receipt.blockHash,gasUsed:item.gasUsed,effectiveGasPrice:item.effectiveGasPrice,runtimeHash});
  }
  for(const item of manifest.internalContracts||[]){
    assert.equal(keccak256(await provider.send('eth_getCode',[item.address,'latest'])),item.runtimeHash,`${item.name}: internal runtime mismatch`);
  }
  return {finalized:{number:finalizedNumber,hash:finalized.hash},receipts};
}

export async function verifyIndependentRpcConsensus({providers,manifest,evidence}){
  assert.equal(providers.length,2,'Exactly two verification providers required');
  const reports=await Promise.all(providers.map(provider=>inspectDeploymentFromRpc({provider,manifest,evidence})));
  assert.deepEqual(reports[0].receipts,reports[1].receipts,'Independent RPCs disagree on deployment receipts/runtime');
  const finalizedNumber=Math.min(...reports.map(report=>report.finalized.number));
  const finalizedBlocks=await Promise.all(providers.map(provider=>provider.send('eth_getBlockByNumber',['0x'+finalizedNumber.toString(16),false])));
  assert.ok(finalizedBlocks.every(block=>block?.hash),'Independent RPC finalized intersection is unavailable');
  assert.equal(finalizedBlocks[0].hash.toLowerCase(),finalizedBlocks[1].hash.toLowerCase(),'Independent RPCs disagree on the finalized chain');
  return {kind:'INDEPENDENT_RPC_CONSENSUS',providerCount:2,finalized:{number:finalizedNumber,hash:finalizedBlocks[0].hash},receipts:reports[0].receipts};
}

export function publicDeploymentRecord({manifest,evidence,registration,receipt,block,finalized,runtimeHash,rpcConsensus}){
  assert.equal(manifest.config.chainId,1,'Public production record requires Ethereum mainnet');
  assert.equal(evidence?.status,'BROADCAST_COMPLETE_RUNTIME_VERIFIED','Complete runtime-verified broadcast evidence required');
  assert.equal(evidence.releaseDigest,manifest.digest,'Broadcast report belongs to a different release');
  assert.equal(evidence.completedSteps,manifest.steps.length,'Broadcast report does not cover every deployment step');
  assert.equal(evidence.totalSteps,manifest.steps.length,'Broadcast report has the wrong graph length');
  assert.equal(evidence.receipts?.length,manifest.steps.length,'Broadcast report must contain every deployment receipt');
  assert.deepEqual(evidence.receipts.map(item=>item.name),manifest.steps.map(step=>step.name),'Broadcast receipts must exactly follow the approved manifest order');
  const collection=manifest.steps.find(step=>step.name==='MyceliumFriends');assert.ok(collection,'Missing collection deployment step');
  const collectionEvidence=evidence.receipts.find(item=>item.name==='MyceliumFriends');assert.ok(collectionEvidence,'Missing collection receipt evidence');
  assert.equal(receipt.status,1,'Collection deployment transaction reverted');
  assert.equal(getAddress(receipt.from),getAddress(manifest.config.deployer),'Collection deployment sender mismatch');
  assert.equal(getAddress(receipt.contractAddress),getAddress(collection.address),'Collection deployment address mismatch');
  assert.equal(receipt.hash.toLowerCase(),collectionEvidence.transactionHash.toLowerCase(),'Collection transaction differs from the broadcast report');
  assert.equal(receipt.blockNumber,collectionEvidence.blockNumber,'Collection receipt block differs from the broadcast report');
  assert.equal(block.hash.toLowerCase(),collectionEvidence.blockHash.toLowerCase(),'Collection block hash differs from the broadcast report');
  assert.ok(finalized&&finalized.number>=receipt.blockNumber,'Collection deployment is not finalized');
  assert.equal(rpcConsensus?.kind,'INDEPENDENT_RPC_CONSENSUS','Independent RPC consensus required');
  assert.equal(rpcConsensus.providerCount,2,'Two independent RPC confirmations required');
  assert.equal(rpcConsensus.receipts?.length,manifest.steps.length,'Independent RPC consensus must cover every receipt');
  const consensusCollection=rpcConsensus.receipts.find(item=>item.name==='MyceliumFriends');assert.ok(consensusCollection,'Independent RPC collection receipt missing');
  assert.equal(consensusCollection.transactionHash.toLowerCase(),receipt.hash.toLowerCase(),'Independent RPC transaction mismatch');
  assert.equal(consensusCollection.blockHash.toLowerCase(),block.hash.toLowerCase(),'Independent RPC block mismatch');
  assert.equal(consensusCollection.runtimeHash,runtimeHash,'Independent RPC runtime mismatch');
  assert.equal(rpcConsensus.finalized.number,finalized.number,'Finalized consensus mismatch');
  assert.equal(rpcConsensus.finalized.hash.toLowerCase(),finalized.hash.toLowerCase(),'Finalized hash consensus mismatch');
  assert.equal(runtimeHash,collection.runtimeHash,'Collection runtime differs from the approved release');
  assert.ok(typeof registration.id==='string'&&/^[a-z0-9-]+$/.test(registration.id),'Invalid public deployment ID');
  assert.ok(typeof registration.label==='string'&&registration.label.trim(),'Invalid public deployment label');
  assert.equal(registration.networkName,'Ethereum','Mainnet networkName must be Ethereum');
  assert.equal(new URL(registration.explorerUrl).protocol,'https:','Explorer must use HTTPS');
  return {
    version:1,kind:'MYCELIUM_VERIFIED_DEPLOYMENT',releaseStatus:'CURRENT_RELEASE',network:'mainnet',chainId:1,
    sourceCommit:manifest.source.commit,releaseDigest:manifest.digest,deploymentTransaction:receipt.hash,deploymentBlock:receipt.blockNumber,deploymentHash:block.hash,
    deployer:getAddress(manifest.config.deployer),finality:{blockNumber:finalized.number,blockHash:finalized.hash},
    collection:{name:registration.label,symbol:'MYFRIENDS',address:getAddress(collection.address),runtimeHash,catalogHash:manifest.catalog.sha256,
      saleCap:manifest.config.saleCap,initialSalePhase:'PAUSED'},
    roles:{owner:getAddress(manifest.config.initialOwner),treasury:getAddress(manifest.config.treasury),royaltyReceiver:getAddress(manifest.config.royaltyReceiver),royaltyBps:manifest.config.royaltyBps},
    protocol:{mint:manifest.mintProtection.protocol,saleLifecycle:manifest.mintProtection.saleLifecycle,
      minimumCommitmentAgeSeconds:manifest.mintProtection.minimumAgeSeconds,maximumCommitmentAgeSeconds:manifest.mintProtection.maximumAgeSeconds},
    contracts:Object.fromEntries(manifest.steps.concat(manifest.internalContracts||[]).map(item=>[item.name,item.address])),
    verification:{broadcastReceiptCount:evidence.receipts.length,internalContractCount:evidence.internalContracts?.length||0,finalized:true,independentRpcProviders:2},
    public:{id:registration.id,label:registration.label,networkName:registration.networkName,explorerUrl:registration.explorerUrl}
  };
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [manifestPath,evidencePath,registrationPath,expectedDigest,outputPath]=process.argv.slice(2);
  if(!outputPath)throw Error('Usage: node tooling/release/register-deployment.mjs manifest.json mainnet-broadcast.json registration.json EXPECTED_DIGEST deployments/core/ethereum/mainnet.json');
  const registration=JSON.parse(await readFile(registrationPath,'utf8'));
  const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  const rpcUrls=validateVerificationRpcUrls(registration.verificationRpcUrls);
  const {manifest,addresses}=await verifyRelease(manifestPath,evidencePath,rpcUrls[0],expectedDigest);
  assert.equal(manifest.config.chainId,1,'This registration path is reserved for mainnet');
  assert.equal(getAddress(addresses.MyceliumFriends),getAddress(manifest.addresses.MyceliumFriends),'Verified collection address mismatch');
  const providers=rpcUrls.map(url=>new JsonRpcProvider(url,1,{cacheTimeout:-1}));
  try{
    const collectionEvidence=evidence.receipts?.find(item=>item.name==='MyceliumFriends');assert.ok(collectionEvidence,'Missing collection receipt in broadcast report');
    const rpcConsensus=await verifyIndependentRpcConsensus({providers,manifest,evidence});
    const collection=rpcConsensus.receipts.find(item=>item.name==='MyceliumFriends');assert.ok(collection,'Independent RPC collection receipt missing');
    const receipt={status:1,from:collection.from,contractAddress:collection.contractAddress,hash:collection.transactionHash,blockNumber:collection.blockNumber};
    const block={number:collection.blockNumber,hash:collection.blockHash},finalized=rpcConsensus.finalized;
    const record=publicDeploymentRecord({manifest,evidence,registration,receipt,block,finalized,runtimeHash:collection.runtimeHash,rpcConsensus});
    const encoded=JSON.stringify(record,null,2)+'\n';
    if(existsSync(outputPath))assert.equal(await readFile(outputPath,'utf8'),encoded,'Refusing to overwrite a different deployment record');
    else await writeFile(outputPath,encoded,{flag:'wx'});
    console.log(`Verified and recorded ${record.collection.name} at ${outputPath}. No transaction sent.`);
  }finally{for(const provider of providers)provider.destroy();}
}
