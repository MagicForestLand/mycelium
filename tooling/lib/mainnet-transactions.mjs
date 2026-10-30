import assert from 'node:assert/strict';
import {Transaction,getAddress,getCreateAddress,keccak256} from 'ethers';
import {canonicalJSON,sha256} from './release-binding.mjs';
import {validateMainnetBroadcastManifest} from './broadcast-release.mjs';

export const MAINNET_TRANSACTION_INTENT='MYCELIUM_MAINNET_DEPLOYMENT_INTENT';
export const MAINNET_DEPLOYMENT_JOURNAL='MYCELIUM_MAINNET_DEPLOYMENT_JOURNAL';
const HASH=/^0x[0-9a-f]{64}$/i,DECIMAL=/^(0|[1-9]\d*)$/;

function transactionForStep(manifest,step){
  const {config}=manifest;
  return Transaction.from({
    type:2,
    chainId:1,
    nonce:step.nonce,
    to:null,
    value:0n,
    data:step.initcode,
    gasLimit:BigInt(config.gasLimits[step.name]),
    maxFeePerGas:BigInt(config.maxFeePerGas),
    maxPriorityFeePerGas:BigInt(config.maxPriorityFeePerGas),
    accessList:[]
  });
}

export function mainnetDeploymentIntent(manifest,expectedDigest,stepIndex){
  validateMainnetBroadcastManifest(manifest,expectedDigest);
  assert.ok(Number.isInteger(stepIndex)&&stepIndex>=0&&stepIndex<manifest.steps.length,'Invalid next deployment step');
  const step=manifest.steps[stepIndex];
  assert.equal(stepIndex,step.nonce-manifest.config.nonce,'Deployment step is not the next sequential nonce');
  assert.equal(getAddress(step.address),getAddress(getCreateAddress({from:manifest.config.deployer,nonce:step.nonce})),`${step.name}: CREATE address changed`);
  const transaction=transactionForStep(manifest,step);
  const payload={
    format:1,
    kind:MAINNET_TRANSACTION_INTENT,
    status:'UNSIGNED_NOT_BROADCAST',
    releaseDigest:manifest.digest,
    chainId:1,
    stepIndex,
    step:step.name,
    expectedContract:step.address,
    from:getAddress(manifest.config.deployer),
    nonce:step.nonce,
    transaction:{
      type:2,
      chainId:'1',
      to:null,
      value:'0',
      nonce:String(step.nonce),
      data:step.initcode,
      initcodeHash:step.initcodeHash,
      gasLimit:transaction.gasLimit.toString(),
      maxFeePerGas:transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas:transaction.maxPriorityFeePerGas.toString(),
      accessList:[],
      unsignedSerialized:transaction.unsignedSerialized,
      unsignedHash:transaction.unsignedHash
    }
  };
  return {...payload,intentDigest:sha256(canonicalJSON(payload))};
}

export function validateMainnetDeploymentIntent(intent,manifest,expectedDigest){
  validateMainnetBroadcastManifest(manifest,expectedDigest);
  assert.equal(intent?.kind,MAINNET_TRANSACTION_INTENT,'Invalid mainnet transaction intent');
  const {intentDigest,...payload}=intent;
  assert.equal(intentDigest,sha256(canonicalJSON(payload)),'Mainnet transaction intent changed');
  assert.equal(intent.releaseDigest,manifest.digest,'Transaction intent belongs to a different release');
  const expected=mainnetDeploymentIntent(manifest,expectedDigest,intent.stepIndex);
  assert.deepEqual(intent,expected,'Transaction intent does not match the approved manifest');
  return intent;
}

export function verifyMainnetSignedTransaction(rawTransaction,intent,manifest,expectedDigest){
  validateMainnetDeploymentIntent(intent,manifest,expectedDigest);
  assert.ok(typeof rawTransaction==='string'&&/^0x[0-9a-f]+$/i.test(rawTransaction),'Provide one raw signed transaction');
  const transaction=Transaction.from(rawTransaction);
  assert.ok(transaction.signature,'Transaction is not signed');
  assert.equal(transaction.type,2,'Signed transaction must be EIP-1559 type 2');
  assert.equal(transaction.chainId,1n,'Signed transaction targets the wrong chain');
  assert.equal(getAddress(transaction.from),getAddress(intent.from),'Signed transaction has the wrong sender');
  assert.equal(transaction.to,null,'Deployment transaction must be CREATE without a to address');
  assert.equal(transaction.value,0n,'Deployment transaction value must be zero');
  assert.equal(transaction.nonce,intent.nonce,'Signed transaction has the wrong nonce');
  assert.equal(transaction.data,intent.transaction.data,'Signed initcode differs from the approved manifest');
  assert.equal(keccak256(transaction.data),intent.transaction.initcodeHash,'Signed initcode hash differs from the approved manifest');
  assert.equal(transaction.gasLimit,BigInt(intent.transaction.gasLimit),'Signed transaction has the wrong gas limit');
  assert.equal(transaction.maxFeePerGas,BigInt(intent.transaction.maxFeePerGas),'Signed transaction has the wrong max fee');
  assert.equal(transaction.maxPriorityFeePerGas,BigInt(intent.transaction.maxPriorityFeePerGas),'Signed transaction has the wrong priority fee');
  assert.deepEqual(transaction.accessList||[],[],'Deployment transaction must not add an access list');
  assert.equal(transaction.unsignedSerialized,intent.transaction.unsignedSerialized,'Signed transaction payload differs from the reviewed unsigned transaction');
  assert.equal(transaction.unsignedHash,intent.transaction.unsignedHash,'Signed transaction hash preimage differs from the reviewed intent');
  return {
    releaseDigest:manifest.digest,
    intentDigest:intent.intentDigest,
    stepIndex:intent.stepIndex,
    step:intent.step,
    expectedContract:intent.expectedContract,
    from:getAddress(transaction.from),
    nonce:transaction.nonce,
    transactionHash:transaction.hash,
    rawTransaction:transaction.serialized
  };
}

export function createMainnetJournal(manifest,expectedDigest){
  validateMainnetBroadcastManifest(manifest,expectedDigest);
  return {format:1,kind:MAINNET_DEPLOYMENT_JOURNAL,releaseDigest:manifest.digest,chainId:1,deployer:getAddress(manifest.config.deployer),entries:[]};
}

export function validateMainnetJournal(journal,manifest,expectedDigest){
  validateMainnetBroadcastManifest(manifest,expectedDigest);
  assert.equal(journal?.format,1,'Invalid mainnet journal format');
  assert.equal(journal?.kind,MAINNET_DEPLOYMENT_JOURNAL,'Invalid mainnet journal kind');
  assert.equal(journal.releaseDigest,manifest.digest,'Mainnet journal belongs to a different release');
  assert.equal(journal.chainId,1,'Mainnet journal targets the wrong chain');
  assert.equal(getAddress(journal.deployer),getAddress(manifest.config.deployer),'Mainnet journal has the wrong deployer');
  assert.ok(Array.isArray(journal.entries)&&journal.entries.length<=manifest.steps.length,'Invalid mainnet journal entries');
  for(const [index,entry] of journal.entries.entries()){
    assert.equal(entry.index,index,'Mainnet journal entries must be a contiguous prefix');
    assert.deepEqual(entry.intent,mainnetDeploymentIntent(manifest,expectedDigest,index),`Journal intent changed at step ${index}`);
    assert.ok(['INTENT_PREPARED','SIGNED_NOT_BROADCAST','BROADCAST','VERIFIED'].includes(entry.status),`Invalid journal status at step ${index}`);
    if(index<journal.entries.length-1)assert.equal(entry.status,'VERIFIED','Only the final journal step may be incomplete');
    if(entry.status!=='INTENT_PREPARED'){
      const signed=verifyMainnetSignedTransaction(entry.rawTransaction,entry.intent,manifest,expectedDigest);
      assert.equal(entry.transactionHash,signed.transactionHash,`Journal transaction hash changed at step ${index}`);
    }else{
      assert.ok(!Object.hasOwn(entry,'rawTransaction')&&!Object.hasOwn(entry,'transactionHash'),'Unsigned intent must not contain signed transaction data');
    }
    if(entry.status==='VERIFIED'){
      assert.ok(entry.receipt&&entry.receipt.transactionHash===entry.transactionHash,`Missing verified receipt at step ${index}`);
      assert.equal(entry.receipt.status,1,`Verified receipt status changed at step ${index}`);
      assert.equal(getAddress(entry.receipt.from),getAddress(manifest.config.deployer),`Verified receipt sender changed at step ${index}`);
      assert.equal(getAddress(entry.receipt.contractAddress),getAddress(entry.intent.expectedContract),`Verified receipt address changed at step ${index}`);
      assert.ok(Number.isSafeInteger(entry.receipt.blockNumber)&&entry.receipt.blockNumber>=0,`Verified receipt block number changed at step ${index}`);
      assert.match(entry.receipt.blockHash,HASH,`Verified receipt block hash changed at step ${index}`);
      assert.match(entry.receipt.gasUsed,DECIMAL,`Verified receipt gas used changed at step ${index}`);
      assert.ok(BigInt(entry.receipt.gasUsed)>0n,`Verified receipt gas used must be positive at step ${index}`);
      assert.match(entry.receipt.effectiveGasPrice,DECIMAL,`Verified receipt gas price changed at step ${index}`);
      assert.ok(BigInt(entry.receipt.effectiveGasPrice)>0n,`Verified receipt gas price must be positive at step ${index}`);
      assert.equal(entry.runtimeHash.toLowerCase(),manifest.steps[index].runtimeHash.toLowerCase(),`Verified runtime hash changed at step ${index}`);
    }
  }
  if(Object.hasOwn(journal,'internalContracts')){
    assert.ok(journal.entries.length===manifest.steps.length&&journal.entries.every(entry=>entry.status==='VERIFIED'),'Internal contracts may be recorded only after the complete graph');
    assert.deepEqual(journal.internalContracts,(manifest.internalContracts||[]).map(({name,address,runtimeHash})=>({name,address,runtimeHash})),'Internal contract evidence differs from the approved manifest');
  }
  return journal;
}

export function journalPrepareNext(journal,manifest,expectedDigest){
  validateMainnetJournal(journal,manifest,expectedDigest);
  const current=journal.entries.at(-1);
  if(current&&current.status!=='VERIFIED')return structuredClone(journal);
  assert.ok(journal.entries.length<manifest.steps.length,'Every deployment step is already journaled');
  const next=structuredClone(journal),index=next.entries.length;
  next.entries.push({index,status:'INTENT_PREPARED',intent:mainnetDeploymentIntent(manifest,expectedDigest,index)});
  return next;
}

export function journalRecordSigned(journal,rawTransaction,manifest,expectedDigest){
  validateMainnetJournal(journal,manifest,expectedDigest);
  const next=structuredClone(journal),entry=next.entries.at(-1);
  assert.ok(entry&&entry.status==='INTENT_PREPARED','Journal is not waiting for a signature');
  const signed=verifyMainnetSignedTransaction(rawTransaction,entry.intent,manifest,expectedDigest);
  Object.assign(entry,{status:'SIGNED_NOT_BROADCAST',rawTransaction:signed.rawTransaction,transactionHash:signed.transactionHash});
  validateMainnetJournal(next,manifest,expectedDigest);return next;
}

export function journalRecordBroadcast(journal,transactionHash,manifest,expectedDigest){
  validateMainnetJournal(journal,manifest,expectedDigest);
  const next=structuredClone(journal),entry=next.entries.at(-1);
  assert.ok(entry&&['SIGNED_NOT_BROADCAST','BROADCAST'].includes(entry.status),'Journal has no signed transaction ready for broadcast');
  assert.equal(transactionHash,entry.transactionHash,'Broadcast returned a different transaction hash');
  entry.status='BROADCAST';validateMainnetJournal(next,manifest,expectedDigest);return next;
}

export function journalRecordVerified(journal,evidence,manifest,expectedDigest){
  validateMainnetJournal(journal,manifest,expectedDigest);
  const next=structuredClone(journal),entry=next.entries.at(-1),step=manifest.steps[entry?.index];
  assert.ok(entry&&['SIGNED_NOT_BROADCAST','BROADCAST'].includes(entry.status),'Journal has no broadcast transaction to verify');
  assert.equal(evidence?.transactionHash,entry.transactionHash,'Receipt belongs to a different transaction');
  assert.equal(Number(evidence.status),1,'Deployment transaction reverted');
  assert.equal(getAddress(evidence.from),getAddress(manifest.config.deployer),'Receipt has the wrong sender');
  assert.equal(getAddress(evidence.contractAddress),getAddress(step.address),'Receipt has the wrong contract address');
  assert.ok(Number.isSafeInteger(evidence.blockNumber)&&evidence.blockNumber>=0,'Receipt has an invalid block number');
  assert.match(evidence.blockHash,HASH,'Receipt has an invalid block hash');
  assert.match(String(evidence.gasUsed),DECIMAL,'Receipt has invalid gas used');assert.ok(BigInt(evidence.gasUsed)>0n,'Receipt gas used must be positive');
  assert.match(String(evidence.effectiveGasPrice),DECIMAL,'Receipt has invalid effective gas price');assert.ok(BigInt(evidence.effectiveGasPrice)>0n,'Receipt effective gas price must be positive');
  assert.equal(evidence.runtimeHash.toLowerCase(),step.runtimeHash.toLowerCase(),'Deployed runtime differs from the approved manifest');
  entry.status='VERIFIED';entry.receipt={transactionHash:entry.transactionHash,blockNumber:evidence.blockNumber,blockHash:evidence.blockHash,
    contractAddress:getAddress(evidence.contractAddress),from:getAddress(evidence.from),status:1,gasUsed:String(evidence.gasUsed),effectiveGasPrice:String(evidence.effectiveGasPrice)};
  entry.runtimeHash=evidence.runtimeHash;
  validateMainnetJournal(next,manifest,expectedDigest);return next;
}

export function mainnetJournalReport(journal,manifest,expectedDigest){
  validateMainnetJournal(journal,manifest,expectedDigest);
  const complete=journal.entries.length===manifest.steps.length&&journal.entries.every(entry=>entry.status==='VERIFIED')&&Object.hasOwn(journal,'internalContracts');
  return {
    status:complete?'BROADCAST_COMPLETE_RUNTIME_VERIFIED':'BROADCAST_IN_PROGRESS_RUNTIME_VERIFIED_PREFIX',
    releaseDigest:manifest.digest,
    chainId:1,
    deployer:getAddress(manifest.config.deployer),
    completedSteps:journal.entries.filter(entry=>entry.status==='VERIFIED').length,
    totalSteps:manifest.steps.length,
    receipts:journal.entries.filter(entry=>entry.status==='VERIFIED').map(entry=>({name:entry.intent.step,address:entry.intent.expectedContract,nonce:entry.intent.nonce,
      transactionHash:entry.transactionHash,...entry.receipt,runtimeHash:entry.runtimeHash})),
    addresses:manifest.addresses,
    internalContracts:journal.internalContracts||[]
  };
}
