import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AbiCoder,keccak256,id,ZeroHash} from 'ethers';
import {createIntent,makeLocalCommitment,maximumPayment,IntentStore,intentKey,protectionState,rememberMint,lastMint,STEP} from '../../../../apps/web/src/mint-protection.js';
const domain={chainId:31337,collection:'0x1111111111111111111111111111111111111111',buyer:'0x2222222222222222222222222222222222222222',deploymentHash:'0x'+'ab'.repeat(32),codeHash:'0x'+'cd'.repeat(32)};
const counts=[32,128,32,16,4,32],selections=[[0,1,2,3,3,5]],record=()=>createIntent(domain,selections,counts,{rng:webcrypto});
class MemoryStorage {
  values=new Map();get length(){return this.values.size;}key(i){return [...this.values.keys()][i];}
  getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,v);}removeItem(k){this.values.delete(k);}
}
test('removing an abandoned mint clears its record and active resume pointer',()=>{
  const storage=new MemoryStorage(),store=new IntentStore(storage,domain,counts),saved=store.save(record());
  rememberMint(store,saved);assert.equal(lastMint(store).hash,saved.hash);
  store.remove(saved);assert.equal(store.read(saved.hash),null);assert.equal(lastMint(store),null);
});
test('resume remembers the selected intent, not insertion order, including completed mints',()=>{
  const storage=new MemoryStorage(),store=new IntentStore(storage,domain,counts);
  const make=n=>store.save(createIntent(domain,selections,counts,{rng:{getRandomValues:bytes=>bytes.fill(n)}}));
  const first=make(1),second=make(2);
  rememberMint(store,second);rememberMint(store,first);
  assert.equal(lastMint(new IntentStore(storage,domain,counts)).hash,first.hash);
  store.save({...first,state:'minted'});
  assert.equal(lastMint(store).state,'minted');
  for(const change of [{buyer:domain.collection},{collection:domain.buyer},{chainId:1},{deploymentHash:'0x'+'12'.repeat(32)},{codeHash:'0x'+'34'.repeat(32)}]){
    assert.equal(lastMint(new IntentStore(storage,{...domain,...change},counts)),null);
  }
});
test('invalid or expired resume pointers fall back to validated pending records without changing them',()=>{
  const storage=new MemoryStorage(),store=new IntentStore(storage,domain,counts);
  const a=store.save(createIntent(domain,selections,counts,{rng:{getRandomValues:bytes=>bytes.fill(1)}}));
  const b=store.save(createIntent(domain,[[1,1,2,3,3,5]],counts,{rng:{getRandomValues:bytes=>bytes.fill(2)}}));
  const pending=store.save({...a,state:'reveal-pending',revealTx:{nonce:2,fromBlock:9,hash:'0x'+'56'.repeat(32)}});
  rememberMint(store,b);store.save({...b,state:'expired'});
  assert.deepEqual(lastMint(store),pending);
  const key=[...storage.values.keys()].find(k=>k.startsWith('myfriends:mint-resume:'));
  for(const value of ['broken','0x'+'ff'.repeat(32)]){
    storage.setItem(key,value);const before=[...storage.values];
    assert.deepEqual(lastMint(store),pending);assert.deepEqual([...storage.values],before);
  }
});
test('local commitment matches exact ABI domain and changes for every binding field',()=>{
  const r=record();assert.equal(r.salt.length,66);assert.notEqual(r.salt,ZeroHash);assert.notEqual(r.salt,record().salt);
  const golden=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','address','uint256[6][]','bytes32'],[id('MyceliumFriends.PublicMint.v1'),domain.chainId,domain.collection,domain.buyer,selections,r.salt]));
  assert.equal(r.hash,golden);
  for(const changed of [{chainId:1},{collection:domain.buyer},{buyer:domain.collection},{selections:[[1,1,2,3,3,5]]},{salt:'0x'+'01'.repeat(32)}])assert.notEqual(makeLocalCommitment({...r,...changed}),r.hash);
  const batch={...r,selections:[selections[0],[1,1,2,3,3,5]]};assert.notEqual(makeLocalCommitment(batch),makeLocalCommitment({...batch,selections:batch.selections.toReversed()}));
});
test('salt requires working cryptographic RNG and rejects zero; trait boundaries remain full width',()=>{
  let length;createIntent(domain,selections,counts,{rng:{getRandomValues(bytes){length=bytes.length;bytes.fill(17);}}});assert.equal(length,32);
  createIntent(domain,[[31,127,31,15,3,31]],counts,{rng:webcrypto});
  for(const rng of [{},null,{getRandomValues(){}}])assert.throws(()=>createIntent(domain,selections,counts,{rng}));
  for(const s of [
    [],
    Array(33).fill(selections[0]),
    [selections[0],selections[0]],
    [[32,0,0,0,0,0]],
    [[0,128,0,0,0,0]],
    [[0,0,32,0,0,0]],
    [[0,0,0,16,0,0]],
    [[0,0,0,0,4,0]],
    [[0,0,0,0,0,32]],
    [[256,0,0,0,0,0]],
    [[1.5,0,0,0,0,0]],
    [[0,0,0,0,-1,0]]
  ])assert.throws(()=>createIntent(domain,s,counts,{rng:webcrypto}));
});
test('Exact and bounded buffer use independent sum of the next q NFT prices',()=>{
  for(const n of [0,1,50,268435400])for(const q of [1,2,32])for(const buffer of [0,1,3,10]){
    const sum=start=>Array.from({length:q},(_,i)=>BigInt(start+i)*STEP).reduce((a,b)=>a+b,0n);
    assert.equal(maximumPayment(sum(n),q,buffer),sum(n+buffer));
  }
  for(const n of [-1,11,1.5,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>maximumPayment(0n,1,n));
});
test('durable recovery round-trip, namespace isolation and failed writes fail closed',()=>{
  const storage=new MemoryStorage(),store=new IntentStore(storage,domain,counts),r=record();store.save(r);
  assert.deepEqual(store.read(r.hash),r);assert.ok(intentKey(r).startsWith('myfriends:mint-intent:v1:'));assert.ok(!intentKey(r).startsWith('myfriends:v1:'));
  assert.deepEqual(store.import(JSON.stringify(r)),r);
  for(const impl of [{setItem(){throw Error();},getItem(){return null;}},{setItem(){},getItem(){return null;}}])assert.throws(()=>new IntentStore(impl,domain,counts).save(r),/could not be saved/);
  for(const text of ['{','x'.repeat(32769),JSON.stringify({...r,salt:ZeroHash}),JSON.stringify({...r,version:2}),JSON.stringify({...r,chainId:1}),JSON.stringify({...r,buyer:domain.collection}),JSON.stringify({...r,selections:[[1,1,2,3,3,5]]})])assert.throws(()=>store.import(text));
});
test('import cannot erase exposure or an already pending submission for the same hash',()=>{
  const store=new IntentStore(new MemoryStorage(),domain,counts),r=record(),commitTx={nonce:3,fromBlock:10,hash:'0x'+'ef'.repeat(32)};
  store.save({...r,state:'commit-pending',commitTx,exposed:true});const recovered=store.import(JSON.stringify(r));
  assert.equal(recovered.exposed,true);assert.deepEqual(recovered.commitTx,commitTx);assert.equal(recovered.state,'commit-pending');
});
test('protection uses explicit missing, inclusive maturity and exclusive expiry',()=>{
  for(const now of [1,1000000])assert.equal(protectionState(0,now),'missing');
  assert.equal(protectionState(100,159),'waiting');assert.equal(protectionState(100,160),'ready');
  assert.equal(protectionState(100,86499),'ready');assert.equal(protectionState(100,86500),'expired');
});
