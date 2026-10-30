import test from 'node:test';
import assert from 'node:assert/strict';
import {Transaction,Wallet,getCreateAddress,keccak256} from 'ethers';
import {createMainnetJournal,journalPrepareNext,journalRecordBroadcast,journalRecordSigned,journalRecordVerified,mainnetDeploymentIntent,mainnetJournalReport,validateMainnetJournal,verifyMainnetSignedTransaction} from '../../tooling/lib/mainnet-transactions.mjs';
import {releaseDigest} from '../../tooling/lib/release-binding.mjs';

const signer=new Wallet('0x'+'11'.repeat(32));
const initcode='0x60006000';

function fixture(){
  const nonce=7,address=getCreateAddress({from:signer.address,nonce});
  const payload={format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',config:{chainId:1,deployer:signer.address,nonce,
    gasLimits:{A:'100000'},maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000'},
    steps:[{name:'A',nonce,address,initcode,initcodeHash:keccak256(initcode),runtimeHash:keccak256('0x6001')}],internalContracts:[],addresses:{A:address}};
  return {...payload,digest:releaseDigest(payload)};
}

const sign=async patch=>{
  const manifest=fixture(),intent=mainnetDeploymentIntent(manifest,manifest.digest,0);
  const base=Transaction.from(intent.transaction.unsignedSerialized);
  const request={type:base.type,chainId:base.chainId,nonce:base.nonce,to:base.to,value:base.value,data:base.data,gasLimit:base.gasLimit,
    maxFeePerGas:base.maxFeePerGas,maxPriorityFeePerGas:base.maxPriorityFeePerGas,accessList:base.accessList,...patch};
  return {manifest,intent,raw:await signer.signTransaction(request)};
};

test('mainnet intent binds exactly one sequential CREATE transaction',()=>{
  const manifest=fixture(),intent=mainnetDeploymentIntent(manifest,manifest.digest,0),tx=Transaction.from(intent.transaction.unsignedSerialized);
  assert.equal(intent.chainId,1);assert.equal(intent.step,'A');assert.equal(intent.expectedContract,manifest.steps[0].address);
  assert.equal(tx.to,null);assert.equal(tx.value,0n);assert.equal(tx.nonce,7);assert.equal(tx.data,initcode);assert.equal(tx.gasLimit,100000n);
  assert.throws(()=>mainnetDeploymentIntent(manifest,manifest.digest,1),/Invalid next/);
});

test('raw signed transaction is decoded and verified before broadcast',async()=>{
  const {manifest,intent,raw}=await sign({});
  const verified=verifyMainnetSignedTransaction(raw,intent,manifest,manifest.digest);
  assert.equal(verified.from,signer.address);assert.equal(verified.nonce,7);assert.equal(verified.transactionHash,keccak256(raw));
});

test('raw signed transaction rejects every material mutation',async()=>{
  for(const patch of [
    {chainId:11155111n},{nonce:8},{to:signer.address},{value:1n},{data:'0x6001'},{gasLimit:99999n},
    {maxFeePerGas:2000000001n},{maxPriorityFeePerGas:999999999n},{accessList:[{address:signer.address,storageKeys:[]}]}
  ]){
    const {manifest,intent,raw}=await sign(patch);
    assert.throws(()=>verifyMainnetSignedTransaction(raw,intent,manifest,manifest.digest));
  }
});

test('intent and signer substitution fail closed',async()=>{
  const {manifest,intent,raw}=await sign({});
  assert.throws(()=>verifyMainnetSignedTransaction(raw,{...intent,step:'B'},manifest,manifest.digest),/intent changed/);
  const other=new Wallet('0x'+'22'.repeat(32));
  const wrong=await other.signTransaction(Transaction.from(intent.transaction.unsignedSerialized));
  assert.throws(()=>verifyMainnetSignedTransaction(wrong,intent,manifest,manifest.digest),/wrong sender/);
});

test('journal persists intent, raw signed transaction, broadcast and verified receipt in order',async()=>{
  const {manifest,raw}=await sign({});let journal=createMainnetJournal(manifest,manifest.digest);
  journal=journalPrepareNext(journal,manifest,manifest.digest);assert.equal(journal.entries[0].status,'INTENT_PREPARED');
  journal=journalRecordSigned(journal,raw,manifest,manifest.digest);assert.equal(journal.entries[0].status,'SIGNED_NOT_BROADCAST');assert.equal(journal.entries[0].rawTransaction,raw);
  journal=journalRecordBroadcast(journal,keccak256(raw),manifest,manifest.digest);assert.equal(journal.entries[0].status,'BROADCAST');
  journal=journalRecordVerified(journal,{transactionHash:keccak256(raw),status:1,from:signer.address,contractAddress:manifest.steps[0].address,
    blockNumber:100,blockHash:'0x'+'ab'.repeat(32),runtimeHash:manifest.steps[0].runtimeHash,gasUsed:'90000',effectiveGasPrice:'1500000000'},manifest,manifest.digest);
  assert.equal(journal.entries[0].status,'VERIFIED');assert.doesNotThrow(()=>validateMainnetJournal(journal,manifest,manifest.digest));
  for(const receiptPatch of [
    {status:0},{from:manifest.steps[0].address},{contractAddress:signer.address},{blockNumber:-1},{blockHash:'0x00'},
    {gasUsed:'NaN'},{gasUsed:'0'},{effectiveGasPrice:'-1'},{effectiveGasPrice:'0'}
  ]){
    const changed=structuredClone(journal);Object.assign(changed.entries[0].receipt,receiptPatch);
    assert.throws(()=>validateMainnetJournal(changed,manifest,manifest.digest));
  }
  const changedRuntime=structuredClone(journal);changedRuntime.entries[0].runtimeHash='0x'+'00'.repeat(32);
  assert.throws(()=>validateMainnetJournal(changedRuntime,manifest,manifest.digest));
  assert.equal(mainnetJournalReport(journal,manifest,manifest.digest).status,'BROADCAST_IN_PROGRESS_RUNTIME_VERIFIED_PREFIX');
  journal={...journal,internalContracts:[]};assert.equal(mainnetJournalReport(journal,manifest,manifest.digest).status,'BROADCAST_COMPLETE_RUNTIME_VERIFIED');
  assert.throws(()=>journalPrepareNext(journal,manifest,manifest.digest),/already journaled/);
});

test('journal rejects gaps, changed intent, wrong hash and false receipt evidence',async()=>{
  const {manifest,raw}=await sign({});let journal=journalPrepareNext(createMainnetJournal(manifest,manifest.digest),manifest,manifest.digest);
  assert.throws(()=>validateMainnetJournal({...journal,entries:[{...journal.entries[0],index:1}]},manifest,manifest.digest),/contiguous/);
  assert.throws(()=>validateMainnetJournal({...journal,entries:[{...journal.entries[0],intent:{...journal.entries[0].intent,step:'B'}}]},manifest,manifest.digest));
  journal=journalRecordSigned(journal,raw,manifest,manifest.digest);
  assert.throws(()=>journalRecordBroadcast(journal,'0x'+'00'.repeat(32),manifest,manifest.digest),/different transaction/);
  for(const patch of [{status:0},{from:manifest.steps[0].address},{contractAddress:signer.address},{runtimeHash:'0x'+'00'.repeat(32)}]){
    const evidence={transactionHash:keccak256(raw),status:1,from:signer.address,contractAddress:manifest.steps[0].address,blockNumber:100,
      blockHash:'0x'+'ab'.repeat(32),runtimeHash:manifest.steps[0].runtimeHash,gasUsed:'90000',effectiveGasPrice:'1500000000',...patch};
    assert.throws(()=>journalRecordVerified(journal,evidence,manifest,manifest.digest));
  }
});
