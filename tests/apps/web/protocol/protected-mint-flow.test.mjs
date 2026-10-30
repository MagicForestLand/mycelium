import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {IntentStore,createIntent} from '../../../../apps/web/src/mint-protection.js';
import {ProtectedMintFlow} from '../../../../apps/web/src/protected-mint-flow.js';
const domain={chainId:31337,collection:'0x1111111111111111111111111111111111111111',buyer:'0x2222222222222222222222222222222222222222',deploymentHash:'0x'+'ab'.repeat(32),codeHash:'0x'+'cd'.repeat(32)};
const counts=[32,128,32,16,4,32],hash='0x'+'ef'.repeat(32),blockHash='0x'+'12'.repeat(32);
function fixture(){
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const store=new IntentStore(storage,domain,counts),record=store.save(createIntent(domain,[[0,0,0,0,0,0]],counts,{rng:webcrypto}));
  const provider={getTransactionCount:async()=>1,getTransactionReceipt:async()=>null,getTransaction:async()=>null,send:async()=>({transactions:[]}),getBlock:async()=>({hash:blockHash})};
  const flow=new ProtectedMintFlow({deployment:{address:domain.collection},provider,store,record,locks:{request:async(k,o,fn)=>fn({name:k})}});
  return {flow,store,provider};
}
test('stale tab cannot overwrite pending state or EXPOSED evidence',()=>{
  const {flow,store}=fixture(),other=new ProtectedMintFlow({...flow});
  flow.save({exposed:true,state:'commit-pending',commitTx:{hash,nonce:0,fromBlock:0}});
  assert.throws(()=>other.save({state:'saved'}),/another tab/);assert.equal(store.read(flow.record.hash).exposed,true);
});
test('replacement recovery scans public blocks by sender/nonce and verifies commit calldata',async()=>{
  const {flow,provider}=fixture();flow.save({commitTx:{hash:null,nonce:0,fromBlock:1}});
  const tx={hash,from:domain.buyer,to:domain.collection,nonce:0,data:flow.contract.interface.encodeFunctionData('commit',[flow.record.hash]),value:0n};
  provider.send=async()=>({transactions:[tx]});provider.getTransaction=async()=>tx;
  provider.getTransactionReceipt=async()=>({status:1,blockNumber:1,blockHash});
  assert.equal((await flow.outcome('commit',{number:2})).state,'confirmed');assert.equal(flow.record.commitTx.hash,hash);
  tx.to=domain.buyer;assert.equal((await flow.outcome('commit',{number:2})).state,'cancelled');
});
test('noncanonical receipt, missing hash and RPC failure cannot enable retry',async()=>{
  const {flow,provider}=fixture();flow.save({revealTx:{hash,nonce:0,fromBlock:1},exposed:true});
  provider.getTransactionReceipt=async()=>({status:1,blockNumber:1,blockHash:'0x'+'ff'.repeat(32)});
  assert.equal((await flow.outcome('reveal',{number:2})).state,'pending');
  provider.getTransactionReceipt=async()=>null;provider.getTransactionCount=async()=>0;
  assert.equal((await flow.outcome('reveal',{number:2})).state,'unknown');
  provider.getTransactionCount=async()=>{throw Error('RPC timeout');};await assert.rejects(()=>flow.outcome('reveal',{number:2}));assert.equal(flow.record.revealTx.hash,hash);
});
test('explicit unsent recovery rejects pending/consumed nonce and known transactions',async()=>{
  const {flow,provider}=fixture();flow.save({commitTx:{hash:null,nonce:0,fromBlock:1},state:'commit-signing'});
  await assert.rejects(()=>flow.confirmNotSent('commit'),/nonce/);
  provider.getTransactionCount=async()=>0;await flow.confirmNotSent('commit');assert.equal(flow.record.commitTx,null);
  flow.save({commitTx:{hash,nonce:0,fromBlock:1}});provider.getTransaction=async()=>({hash});
  await assert.rejects(()=>flow.confirmNotSent('commit'),/still knows/);
});
test('wrong signer account and network fail before any selected reveal is sent',async()=>{
  const {flow}=fixture();flow.getSigner=async()=>({getAddress:async()=>domain.collection,provider:{getNetwork:async()=>({chainId:31337})}});
  await assert.rejects(()=>flow.writable(),/original wallet/);
  flow.getSigner=async()=>({getAddress:async()=>domain.buyer,provider:{getNetwork:async()=>({chainId:1})}});
  await assert.rejects(()=>flow.writable(),/original wallet/);
});
test('protected flow refuses commit and reveal review while public mint is paused',async()=>{
  const {flow}=fixture();
  flow.sync=async()=>({state:'missing',head:{number:10,timestamp:1000}});
  flow.contract={salePhase:async()=>3n};
  await assert.rejects(()=>flow.sendCommit(),/not active/);
  flow.sync=async()=>({state:'ready',head:{number:10,timestamp:1000}});
  flow.contract={mintPrice:async()=>0n,totalMinted:async()=>0n,saleCap:async()=>1000n,salePhase:async()=>3n};
  await assert.rejects(()=>flow.review(0),/temporarily unavailable/);
});

function wrappedReceipt(flow, phase) {
  const event = (name, args, address=domain.collection) => ({address,...flow.contract.interface.encodeEventLog(flow.contract.interface.getEvent(name),args)})
  const logs = phase==='commit' ? [event('CommitmentSubmitted',[domain.buyer,flow.record.hash,1000])] : [
    event('CommitmentConsumed',[domain.buyer,flow.record.hash]),
    event('GenotypeAssigned',[5,0]),
    event('Transfer',['0x0000000000000000000000000000000000000000',domain.buyer,5])
  ]
  return {hash,status:1,blockNumber:1,blockHash,logs}
}
for(const phase of ['commit','reveal'])test(`wrapped ${phase} recognizes canonical collection events without direct calldata`,async()=>{
  const {flow,provider}=fixture()
  flow.save({[phase+'Tx']:{hash,nonce:0,fromBlock:1}})
  provider.getTransaction=async()=>({from:domain.buyer,to:'0x3333333333333333333333333333333333333333',nonce:0,data:'0xcef6d209'})
  provider.getTransactionReceipt=async()=>wrappedReceipt(flow,phase)
  assert.equal((await flow.outcome(phase,{number:2})).state,'confirmed')
})
test('wrapped reveal rejects foreign events, wrong commitment and incomplete selection',async()=>{
  const {flow,provider}=fixture()
  flow.save({revealTx:{hash,nonce:0,fromBlock:1}})
  provider.getTransaction=async()=>({from:domain.buyer,to:domain.buyer,nonce:0,data:'0xcef6d209'})
  for(const alter of [
    r=>{r.status=0},
    r=>{r.blockHash='0x'+'98'.repeat(32)},
    r=>{r.logs.forEach(l=>{l.address=domain.buyer})},
    r=>{r.logs[0].topics[2]='0x'+'99'.repeat(32)},
    r=>{r.logs.pop()}
  ]){
    const receipt=wrappedReceipt(flow,'reveal');alter(receipt)
    provider.getTransactionReceipt=async()=>receipt
    assert.notEqual((await flow.outcome('reveal',{number:2})).state,'confirmed')
  }
})

test('lost wrapped reveal is recovered from exact canonical commitment events without another wallet request',async()=>{
  const {flow,provider}=fixture()
  flow.deployment.deploymentBlock=0
  flow.save({exposed:true,state:'saved',commitTx:{hash:'0x'+'34'.repeat(32),nonce:0,fromBlock:0}})
  flow.verify=async()=>{}
  flow.head=async()=>({number:2,timestamp:1060})
  provider.getLogs=async filter=>{
    assert.equal(filter.address,domain.collection)
    assert.equal(filter.topics[2],flow.record.hash)
    return [{transactionHash:hash}]
  }
  provider.getTransactionReceipt=async()=>wrappedReceipt(flow,'reveal')
  provider.getTransaction=async()=>({nonce:1,to:domain.buyer,data:'0xcef6d209'})
  const status=await flow.sync()
  assert.equal(status.state,'minted')
  assert.deepEqual(status.ids,[5n])
  assert.equal(flow.record.revealTx.hash,hash)
  assert.equal((await flow.sync()).state,'minted')
  await assert.rejects(()=>flow.sendCommit(),/already submitted/)
})

test('slider updates only the explicit buffer, preserving reviewed price and expiry',async()=>{
  const {flow}=fixture()
  flow.sync=async()=>({state:'ready',head:{number:10,timestamp:1000}})
  flow.contract={mintPrice:async()=>0n,totalMinted:async()=>0n,saleCap:async()=>5n,salePhase:async()=>2n}
  const initial=await flow.review(0)
  const updated=flow.setBuffer(3)
  assert.equal(updated.price,initial.price)
  assert.equal(updated.deadline,initial.deadline)
  assert.equal(updated.maximum,300000000000000n)
  assert.equal(flow.record.reviews.at(-1).buffer,3)
  for(const value of [-1,1.5,5,11])assert.throws(()=>flow.setBuffer(value))
  assert.equal(flow.quote,updated)
  assert.equal(flow.setBuffer(0).maximum,0n)
})

test('manual recovery accepts a canonical wrapped mint but not an unrelated transaction',async()=>{
  const {flow,provider}=fixture()
  flow.save({exposed:true,revealTx:{hash:null,nonce:0,fromBlock:1}})
  flow.verify=async()=>{}
  flow.head=async()=>({number:2,timestamp:1060})
  provider.getTransaction=async()=>({nonce:0,to:domain.buyer,data:'0xcef6d209'})
  provider.getTransactionReceipt=async()=>wrappedReceipt(flow,'reveal')
  assert.equal((await flow.attachTransaction(hash,'reveal')).state,'minted')
  const r=wrappedReceipt(flow,'reveal');r.logs[0].topics[2]='0x'+'99'.repeat(32)
  provider.getTransactionReceipt=async()=>r
  await assert.rejects(()=>flow.attachTransaction(hash,'reveal'),/does not match/)
})
