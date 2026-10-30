import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Transaction,Wallet,getCreateAddress,keccak256} from 'ethers';
import {broadcastMainnetJournalEntry,prepareNextMainnetIntent,verifyMainnetJournalOnChain,writePrivateJSON} from '../../tooling/release/mainnet-release.mjs';
import {createMainnetJournal,journalPrepareNext,journalRecordSigned} from '../../tooling/lib/mainnet-transactions.mjs';
import {releaseDigest} from '../../tooling/lib/release-binding.mjs';

const signer=new Wallet('0x'+'11'.repeat(32));
const owner='0x2222222222222222222222222222222222222222';
const emptyHash=keccak256('0x'),runtime='0x6001600055',initcode='0x60006000';

function fixture(){
  const nonce=7,address=getCreateAddress({from:signer.address,nonce});
  const config={kind:'PRODUCTION',chainId:1,deployer:signer.address,nonce,initialOwner:owner,treasury:owner,royaltyReceiver:owner,royaltyBps:500,saleCap:1000,
    roleCodeHashes:{initialOwner:emptyHash,treasury:emptyHash,royaltyReceiver:emptyHash},treasuryProbeWei:'1',balanceBufferWei:'0',
    gasLimits:{MyceliumFriends:'100000'},maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000'};
  const step={name:'MyceliumFriends',nonce,address,initcode,initcodeHash:keccak256(initcode),runtimeHash:keccak256(runtime)};
  const payload={format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',config,steps:[step],internalContracts:[],addresses:{MyceliumFriends:address}};
  return {...payload,digest:releaseDigest(payload)};
}

async function signedFixture(){
  const manifest=fixture();let journal=journalPrepareNext(createMainnetJournal(manifest,manifest.digest),manifest,manifest.digest);
  const raw=await signer.signTransaction(Transaction.from(journal.entries[0].intent.transaction.unsignedSerialized));
  return {manifest,journal,raw,hash:keccak256(raw)};
}

function network(manifest,raw,{known=false,mined=false,foreignPending=false,broadcastTimeout=false}={}){
  const step=manifest.steps[0],hash=keccak256(raw),receiptBlock='0x65',receiptHash='0x'+'65'.repeat(32),calls=[];
  let isKnown=known||mined,isMined=mined,head=mined?102n:100n,reorged=false;
  const rpcTx=()=>({hash,from:signer.address,to:null,value:'0x0',nonce:'0x7',input:initcode,gas:'0x186a0',maxFeePerGas:'0x77359400',maxPriorityFeePerGas:'0x3b9aca00',chainId:'0x1',blockNumber:isMined?receiptBlock:null});
  const rpcReceipt=()=>isMined?{transactionHash:hash,status:'0x1',from:signer.address,contractAddress:step.address,blockNumber:receiptBlock,blockHash:receiptHash,
    gasUsed:'0x15f90',effectiveGasPrice:'0x59682f00'}:null;
  const provider={
    async send(method,args){calls.push(method);
      if(method==='eth_chainId')return '0x1';
      if(method==='eth_getTransactionByHash')return isKnown?rpcTx():null;
      if(method==='eth_getTransactionReceipt')return rpcReceipt();
      if(method==='eth_blockNumber')return '0x'+head.toString(16);
      if(method==='eth_getTransactionCount'){
        if(args[0].toLowerCase()!==signer.address.toLowerCase())return '0x0';
        if(isMined)return '0x8';
        if(foreignPending||isKnown)return args[1]==='pending'?'0x8':'0x7';
        return '0x7';
      }
      if(method==='eth_getCode'){
        if(args[0].toLowerCase()===step.address.toLowerCase()&&isMined)return runtime;
        return '0x';
      }
      if(method==='eth_getBalance')return '0xffffffffffffffff';
      if(method==='eth_call')return '0x';
      if(method==='eth_getBlockByNumber'){
        if(args[0]===receiptBlock)return {number:receiptBlock,hash:reorged?'0x'+'66'.repeat(32):receiptHash,gasLimit:'0x3938700',baseFeePerGas:'0x3b9aca00'};
        return {number:'0x64',hash:'0x'+'64'.repeat(32),gasLimit:'0x3938700',baseFeePerGas:'0x3b9aca00'};
      }
      throw Error(`Unexpected RPC ${method}`);
    },
    async broadcastTransaction(value){calls.push('broadcastTransaction');assert.equal(value,raw);isKnown=true;if(broadcastTimeout)throw Error('simulated RPC timeout after acceptance');return {hash};},
    async waitForTransaction(value,confirmations){calls.push('waitForTransaction');assert.equal(value,hash);assert.equal(confirmations,2);isKnown=true;isMined=true;head=102n;return rpcReceipt();}
  };
  return {provider,calls,get known(){return isKnown;},get mined(){return isMined;},reorg(){reorged=true;}};
}

test('intent preparation is read-only and binds the next empty on-chain prefix',async()=>{
  const {manifest,raw}=await signedFixture(),net=network(manifest,raw);
  const result=await prepareNextMainnetIntent({manifest,expectedDigest:manifest.digest,provider:net.provider,journal:createMainnetJournal(manifest,manifest.digest)});
  assert.equal(result.intent.step,'MyceliumFriends');assert.equal(result.journal.entries[0].status,'INTENT_PREPARED');
  assert.equal(net.calls.includes('broadcastTransaction'),false);
});

test('mainnet release refuses a contract owner without an explicit Safe policy',async()=>{
  const manifest=fixture();manifest.config.roleCodeHashes.initialOwner=keccak256('0x6001');manifest.digest=releaseDigest(manifest);
  await assert.rejects(()=>prepareNextMainnetIntent({manifest,expectedDigest:manifest.digest,provider:{},
    journal:createMainnetJournal(manifest,manifest.digest)}),/Safe policy/);
});

test('raw transaction is journaled before the sole broadcast and verified after receipt',async()=>{
  const {manifest,journal,raw}=await signedFixture(),net=network(manifest,raw),persisted=[];
  const result=await broadcastMainnetJournalEntry({manifest,expectedDigest:manifest.digest,provider:net.provider,journal,rawTransaction:raw,confirmations:2,
    persist:async value=>persisted.push(structuredClone(value))});
  assert.deepEqual(persisted.map(value=>value.entries[0].status),['SIGNED_NOT_BROADCAST','BROADCAST','VERIFIED']);
  assert.ok(net.calls.indexOf('broadcastTransaction')>net.calls.indexOf('eth_getTransactionCount'));
  assert.equal(result.journal.entries[0].status,'VERIFIED');assert.equal(net.calls.filter(call=>call==='broadcastTransaction').length,1);
});

test('restart adopts the same pending hash and never broadcasts a replacement',async()=>{
  const item=await signedFixture();item.journal=journalRecordSigned(item.journal,item.raw,item.manifest,item.manifest.digest);
  const net=network(item.manifest,item.raw,{known:true}),result=await broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,
    provider:net.provider,journal:item.journal,confirmations:2,persist:async()=>{}});
  assert.equal(result.journal.entries[0].status,'VERIFIED');assert.equal(net.calls.includes('broadcastTransaction'),false);
});

test('restart verifies an already mined signed hash without rebroadcast',async()=>{
  const item=await signedFixture();item.journal=journalRecordSigned(item.journal,item.raw,item.manifest,item.manifest.digest);
  const net=network(item.manifest,item.raw,{mined:true}),result=await broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,
    provider:net.provider,journal:item.journal,confirmations:2,persist:async()=>{}});
  assert.equal(result.journal.entries[0].status,'VERIFIED');assert.equal(net.calls.includes('broadcastTransaction'),false);assert.equal(net.calls.includes('waitForTransaction'),false);
});

test('unknown pending nonce fails closed without a deployment broadcast',async()=>{
  const item=await signedFixture(),net=network(item.manifest,item.raw,{foreignPending:true});
  await assert.rejects(()=>broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:item.journal,
    rawTransaction:item.raw,confirmations:2,persist:async()=>{}}),/pending transaction/);
  assert.equal(net.calls.includes('broadcastTransaction'),false);
});

test('timeout after RPC acceptance resumes only the identical raw transaction',async()=>{
  const item=await signedFixture(),net=network(item.manifest,item.raw,{broadcastTimeout:true}),persisted=[];
  await assert.rejects(()=>broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:item.journal,
    rawTransaction:item.raw,confirmations:2,persist:async value=>persisted.push(structuredClone(value))}),/timeout/);
  assert.deepEqual(persisted.map(value=>value.entries[0].status),['SIGNED_NOT_BROADCAST']);assert.equal(net.known,true);
  const resumed=await broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:persisted[0],
    rawTransaction:item.raw,confirmations:2,persist:async value=>persisted.push(structuredClone(value))});
  assert.equal(resumed.journal.entries[0].status,'VERIFIED');assert.equal(net.calls.filter(call=>call==='broadcastTransaction').length,1);
});

test('signed uncertainty blocks the next intent and a reorg invalidates verified journal evidence',async()=>{
  const item=await signedFixture(),net=network(item.manifest,item.raw),persisted=[];
  const signed=journalRecordSigned(item.journal,item.raw,item.manifest,item.manifest.digest);
  await assert.rejects(()=>prepareNextMainnetIntent({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:signed}),/resolved/);
  const completed=await broadcastMainnetJournalEntry({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:signed,
    rawTransaction:item.raw,confirmations:2,persist:async value=>persisted.push(structuredClone(value))});
  await assert.rejects(()=>prepareNextMainnetIntent({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:completed.journal}),/complete deployment graph/);
  net.reorg();
  await assert.rejects(()=>verifyMainnetJournalOnChain({manifest:item.manifest,expectedDigest:item.manifest.digest,provider:net.provider,journal:completed.journal,confirmations:2}),/not canonical/);
});

test('external journal writes are atomic JSON with owner-only permissions',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mycelium-mainnet-journal-')),target=path.join(directory,'journal.json');
  try{
    await writePrivateJSON(target,{status:'SIGNED_NOT_BROADCAST'});
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),{status:'SIGNED_NOT_BROADCAST'});
    assert.equal((await stat(target)).mode&0o777,0o600);
  }finally{await rm(directory,{recursive:true,force:true});}
});
