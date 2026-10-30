import assert from 'node:assert/strict';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,getAddress,keccak256} from 'ethers';
import {inspectBroadcastProgress,inspectResumeNetwork,validateMainnetBroadcastManifest} from '../lib/broadcast-release.mjs';
import {inspectProductionNetwork} from '../verification/release-preflight.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {assertSafeRoleBinding,inspectSafePolicy,loadBoundSafePolicy} from '../verification/verify-safe-policy.mjs';
import {
  createMainnetJournal,journalPrepareNext,journalRecordBroadcast,journalRecordSigned,journalRecordVerified,
  mainnetJournalReport,validateMainnetJournal,verifyMainnetSignedTransaction
} from '../lib/mainnet-transactions.mjs';

const quantity=value=>BigInt(value);
const rpcNonce=(provider,address,tag)=>provider.send('eth_getTransactionCount',[address,tag]).then(quantity);
const EMPTY_CODE_HASH=keccak256('0x');

function requireContractOwnerPolicy(manifest,safePolicy){
  if(manifest.config.roleCodeHashes.initialOwner!==EMPTY_CODE_HASH)assert.ok(safePolicy,'Contract initial owner requires the release-bound Safe policy');
}

export async function writePrivateJSON(target,value){
  assertExternalOutput(target);const resolved=path.resolve(target),directory=path.dirname(resolved);
  await mkdir(directory,{recursive:true});
  const temporary=`${resolved}.${process.pid}.${Date.now()}.tmp`;
  let file;
  try{
    file=await open(temporary,'wx',0o600);
    await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.chmod(0o600);await file.sync();await file.close();file=null;
    await rename(temporary,resolved);
    const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
  }catch(error){
    await file?.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;
  }
}

async function preflightNext({manifest,provider,progress,safePolicy}){
  if(progress.completedCount===0)return inspectProductionNetwork({manifest,provider,deployer:manifest.config.deployer,safePolicy});
  if(progress.completedCount<manifest.steps.length)return inspectResumeNetwork({manifest,provider,progress});
  throw Error('The complete deployment graph is already present.');
}

function verifiedJournalCount(journal){return journal.entries.filter(entry=>entry.status==='VERIFIED').length;}

export async function prepareNextMainnetIntent({manifest,expectedDigest,provider,journal,safePolicy}){
  validateMainnetBroadcastManifest(manifest,expectedDigest);validateMainnetJournal(journal,manifest,expectedDigest);
  requireContractOwnerPolicy(manifest,safePolicy);
  if(safePolicy){assertSafeRoleBinding(manifest.config,safePolicy);await inspectSafePolicy({provider,policy:safePolicy});}
  await verifyMainnetJournalOnChain({manifest,expectedDigest,provider,journal,confirmations:2});
  const pending=journal.entries.at(-1);
  if(pending&&pending.status!=='VERIFIED'){
    assert.equal(pending.status,'INTENT_PREPARED','A signed deployment transaction must be resolved before preparing another intent');
    return {journal,intent:pending.intent,reused:true};
  }
  const progress=await inspectBroadcastProgress({manifest,provider});
  assert.equal(progress.completedCount,verifiedJournalCount(journal),'On-chain deployment prefix differs from the verified journal');
  await preflightNext({manifest,provider,progress,safePolicy});
  const next=journalPrepareNext(journal,manifest,expectedDigest);
  return {journal:next,intent:next.entries.at(-1).intent,reused:false};
}

async function assertKnownTransaction(provider,signed,manifest){
  const transaction=await provider.send('eth_getTransactionByHash',[signed.transactionHash]);
  if(!transaction)return null;
  assert.equal(transaction.hash.toLowerCase(),signed.transactionHash.toLowerCase(),'RPC returned a different transaction hash');
  assert.equal(getAddress(transaction.from),getAddress(signed.from),'RPC transaction sender differs from the signed transaction');
  assert.equal(transaction.to,null,'RPC transaction is not CREATE');
  assert.equal(quantity(transaction.value),0n,'RPC transaction value is not zero');
  assert.equal(quantity(transaction.nonce),BigInt(signed.nonce),'RPC transaction nonce differs from the signed transaction');
  assert.equal((transaction.input||transaction.data).toLowerCase(),manifest.steps[signed.stepIndex].initcode.toLowerCase(),'RPC transaction initcode differs from the signed transaction');
  assert.equal(quantity(transaction.gas),BigInt(manifest.config.gasLimits[signed.step]),'RPC transaction gas limit differs from the signed transaction');
  assert.equal(quantity(transaction.maxFeePerGas),BigInt(manifest.config.maxFeePerGas),'RPC transaction max fee differs from the signed transaction');
  assert.equal(quantity(transaction.maxPriorityFeePerGas),BigInt(manifest.config.maxPriorityFeePerGas),'RPC transaction priority fee differs from the signed transaction');
  if(transaction.chainId!==undefined)assert.equal(quantity(transaction.chainId),1n,'RPC transaction targets the wrong chain');
  return transaction;
}

async function verifiedReceiptEvidence({provider,signed,manifest,confirmations}){
  const receipt=await provider.send('eth_getTransactionReceipt',[signed.transactionHash]);
  if(!receipt)return null;
  assert.equal(quantity(receipt.status),1n,`${signed.step}: deployment transaction reverted`);
  assert.equal(getAddress(receipt.from),getAddress(signed.from),`${signed.step}: receipt sender mismatch`);
  assert.equal(getAddress(receipt.contractAddress),getAddress(signed.expectedContract),`${signed.step}: receipt contract address mismatch`);
  const block=await provider.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
  assert.equal(block?.hash?.toLowerCase(),receipt.blockHash.toLowerCase(),`${signed.step}: receipt block is not canonical`);
  const head=await provider.send('eth_blockNumber',[]),depth=quantity(head)-quantity(receipt.blockNumber)+1n;
  if(depth<BigInt(confirmations))return null;
  const runtimeHash=keccak256(await provider.send('eth_getCode',[signed.expectedContract,receipt.blockNumber]));
  assert.equal(runtimeHash,manifest.steps[signed.stepIndex].runtimeHash,`${signed.step}: deployed runtime hash mismatch`);
  return {transactionHash:signed.transactionHash,status:1,from:receipt.from,contractAddress:receipt.contractAddress,
    blockNumber:Number(quantity(receipt.blockNumber)),blockHash:receipt.blockHash,runtimeHash,
    gasUsed:quantity(receipt.gasUsed).toString(),effectiveGasPrice:quantity(receipt.effectiveGasPrice).toString()};
}

export async function verifyMainnetJournalOnChain({manifest,expectedDigest,provider,journal,confirmations=2}){
  validateMainnetJournal(journal,manifest,expectedDigest);
  for(const entry of journal.entries.filter(item=>item.status==='VERIFIED')){
    const signed=verifyMainnetSignedTransaction(entry.rawTransaction,entry.intent,manifest,expectedDigest);
    assert.ok(await assertKnownTransaction(provider,signed,manifest),`${entry.intent.step}: verified transaction is missing from the selected RPC`);
    const evidence=await verifiedReceiptEvidence({provider,signed,manifest,confirmations});
    assert.ok(evidence,`${entry.intent.step}: verified receipt is missing, noncanonical, or under-confirmed`);
    assert.equal(evidence.blockNumber,entry.receipt.blockNumber,`${entry.intent.step}: receipt block number changed`);
    assert.equal(evidence.blockHash.toLowerCase(),entry.receipt.blockHash.toLowerCase(),`${entry.intent.step}: receipt block hash changed`);
    assert.equal(evidence.gasUsed,entry.receipt.gasUsed,`${entry.intent.step}: receipt gas used changed`);
    assert.equal(evidence.effectiveGasPrice,entry.receipt.effectiveGasPrice,`${entry.intent.step}: receipt effective gas price changed`);
    assert.equal(evidence.runtimeHash,entry.runtimeHash,`${entry.intent.step}: verified runtime changed`);
  }
  return true;
}

export async function broadcastMainnetJournalEntry({manifest,expectedDigest,provider,journal,rawTransaction,confirmations=2,persist=async()=>{},safePolicy}){
  validateMainnetBroadcastManifest(manifest,expectedDigest);validateMainnetJournal(journal,manifest,expectedDigest);
  requireContractOwnerPolicy(manifest,safePolicy);
  if(safePolicy){assertSafeRoleBinding(manifest.config,safePolicy);await inspectSafePolicy({provider,policy:safePolicy});}
  assert.ok(Number.isInteger(confirmations)&&confirmations>=2,'Mainnet deployment requires at least two confirmations');
  assert.equal(quantity(await provider.send('eth_chainId',[])),1n,'Wrong chainId');
  await verifyMainnetJournalOnChain({manifest,expectedDigest,provider,journal,confirmations});
  let current=journal,entry=current.entries.at(-1);
  assert.ok(entry&&entry.status!=='VERIFIED','Prepare one unsigned mainnet intent before broadcasting');
  if(entry.status==='INTENT_PREPARED'){
    current=journalRecordSigned(current,rawTransaction,manifest,expectedDigest);
    await persist(current);entry=current.entries.at(-1);
  }else if(rawTransaction!==undefined){
    const signed=verifyMainnetSignedTransaction(rawTransaction,entry.intent,manifest,expectedDigest);
    assert.equal(signed.transactionHash,entry.transactionHash,'Provided signed transaction differs from the journal');
  }
  const signed=verifyMainnetSignedTransaction(entry.rawTransaction,entry.intent,manifest,expectedDigest);
  let known=await assertKnownTransaction(provider,signed,manifest);
  let evidence=await verifiedReceiptEvidence({provider,signed,manifest,confirmations});
  if(!known&&!evidence){
    const progress=await inspectBroadcastProgress({manifest,provider});
    assert.equal(progress.completedCount,verifiedJournalCount(current),'On-chain deployment prefix differs from the verified journal');
    await preflightNext({manifest,provider,progress,safePolicy});
    assert.equal(await provider.send('eth_getCode',[signed.expectedContract,'latest']),'0x','Expected CREATE address became occupied');
    assert.equal(await rpcNonce(provider,signed.from,'latest'),BigInt(signed.nonce),'Latest nonce changed before broadcast');
    assert.equal(await rpcNonce(provider,signed.from,'pending'),BigInt(signed.nonce),'A different pending transaction blocks this nonce');
    const response=await provider.broadcastTransaction(signed.rawTransaction);
    assert.equal(response.hash.toLowerCase(),signed.transactionHash.toLowerCase(),'RPC broadcast returned a different transaction hash');
    current=journalRecordBroadcast(current,signed.transactionHash,manifest,expectedDigest);await persist(current);
    known=await assertKnownTransaction(provider,signed,manifest)||{hash:signed.transactionHash};
  }else if(entry.status==='SIGNED_NOT_BROADCAST'){
    current=journalRecordBroadcast(current,signed.transactionHash,manifest,expectedDigest);await persist(current);
  }
  if(!evidence){
    assert.ok(known,'Broadcast transaction disappeared from the selected RPC');
    await provider.waitForTransaction(signed.transactionHash,confirmations);
    evidence=await verifiedReceiptEvidence({provider,signed,manifest,confirmations});
    assert.ok(evidence,'Transaction wait completed without a canonical receipt');
  }
  current=journalRecordVerified(current,evidence,manifest,expectedDigest);
  if(current.entries.length===manifest.steps.length&&current.entries.every(item=>item.status==='VERIFIED')){
    const internalContracts=[];
    for(const item of manifest.internalContracts||[]){
      const runtimeHash=keccak256(await provider.send('eth_getCode',[item.address,'latest']));
      assert.equal(runtimeHash,item.runtimeHash,`${item.name}: internal runtime hash mismatch`);
      internalContracts.push({name:item.name,address:item.address,runtimeHash});
    }
    current={...current,internalContracts};
  }
  await persist(current);
  return {journal:current,evidence,report:mainnetJournalReport(current,manifest,expectedDigest)};
}

function parse(argv){
  const [command,manifestPath,...rest]=argv,take=flag=>{const i=rest.indexOf(flag);return i<0?undefined:rest[i+1];};
  return {command,manifestPath,expectedDigest:take('--expected-release'),deployer:take('--deployer'),journalPath:take('--journal'),
    intentPath:take('--intent'),signedPath:take('--signed'),reportPath:take('--report'),safePolicyPath:take('--safe-policy'),confirmations:Number(take('--confirmations')||2)};
}

async function loadRaw(pathname){
  const text=(await readFile(pathname,'utf8')).trim();
  if(text.startsWith('{'))return JSON.parse(text).rawTransaction;
  return text;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=parse(process.argv.slice(2));
  assert.ok(['intent','broadcast'].includes(args.command)&&args.manifestPath&&args.expectedDigest&&args.journalPath,
    'Usage: RPC_URL=... node tooling/release/mainnet-release.mjs intent|broadcast manifest.json --expected-release SHA256 --journal /external/journal.json [--deployer ADDRESS --intent /external/intent.json | --signed /external/raw.txt --report /external/report.json --confirmations N]');
  assert.ok(process.env.RPC_URL,'Explicit RPC_URL required');assertExternalOutput(args.journalPath);
  const manifest=JSON.parse(await readFile(args.manifestPath,'utf8')),
    safePolicy=manifest.config.roleCodeHashes.initialOwner!==EMPTY_CODE_HASH?await loadBoundSafePolicy(args.safePolicyPath):undefined;
  await verifyProductionInputs(manifest,args.expectedDigest);
  const provider=new JsonRpcProvider(process.env.RPC_URL,1,{cacheTimeout:-1});
  try{
    const journal=existsSync(args.journalPath)?JSON.parse(await readFile(args.journalPath,'utf8')):createMainnetJournal(manifest,args.expectedDigest);
    if(args.command==='intent'){
      assert.ok(args.deployer&&args.intentPath,'intent requires --deployer and --intent');assertExternalOutput(args.intentPath);
      assert.equal(getAddress(args.deployer),getAddress(manifest.config.deployer),'Selected deployer differs from approved deployer');
      const result=await prepareNextMainnetIntent({manifest,expectedDigest:args.expectedDigest,provider,journal,safePolicy});
      await writePrivateJSON(args.journalPath,result.journal);await writePrivateJSON(args.intentPath,result.intent);
      console.log(`Prepared ${result.intent.step} nonce ${result.intent.nonce}. UNSIGNED; no transaction sent.`);
    }else{
      assert.ok(args.signedPath&&args.reportPath,'broadcast requires --signed and --report');assertExternalOutput(args.signedPath);assertExternalOutput(args.reportPath);
      const rawTransaction=await loadRaw(args.signedPath);
      const result=await broadcastMainnetJournalEntry({manifest,expectedDigest:args.expectedDigest,provider,journal,rawTransaction,confirmations:args.confirmations,safePolicy,
        persist:value=>writePrivateJSON(args.journalPath,value)});
      await writePrivateJSON(args.reportPath,result.report);
      console.log(`Verified ${result.evidence.transactionHash} at ${result.evidence.blockHash}. Run intent again for the next step.`);
    }
  }finally{provider.destroy();}
}
