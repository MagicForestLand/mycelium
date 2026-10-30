import {AbiCoder,keccak256,id,isAddress,ZeroAddress,ZeroHash,hexlify} from 'ethers';
import {MINT_PRICE_STEP} from './mint-price.js';
export const MINT_PROTOCOL='commit-reveal-v1';
export const COMMITMENT_DOMAIN=id('MyceliumFriends.PublicMint.v1');
export const MIN_AGE=60,MAX_AGE=86400,DEADLINE_SECONDS=600,MAX_BUFFER=10;
export const STEP=MINT_PRICE_STEP;
const HEX32=/^0x[0-9a-f]{64}$/i;
const states=new Set(['saved','commit-signing','commit-pending','waiting','ready','reveal-signing','reveal-pending','exposed','minted','expired']);
export function validateSelections(selections,counts){
  if(!Array.isArray(counts)||counts.length!==6||!counts.every(n=>Number.isSafeInteger(n)&&n>0&&n<=256))throw Error('Invalid trait counts.');
  if(!Array.isArray(selections)||!selections.length||selections.length>32)throw Error('Choose 1 to 32 myFriends.');
  const seen=new Set();
  for(const values of selections){
    if(!Array.isArray(values)||values.length!==6||values.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>=counts[i]))throw Error('Invalid selection.');
    const key=values.join(',');if(seen.has(key))throw Error('Choose different myFriends within a batch.');seen.add(key);
  }
}
export function makeLocalCommitment({chainId,collection,buyer,selections,salt}){
  if(!Number.isSafeInteger(chainId)||chainId<1||!isAddress(collection)||collection===ZeroAddress||!isAddress(buyer)||buyer===ZeroAddress||!HEX32.test(salt)||salt===ZeroHash)throw Error('Invalid protection domain or secret.');
  return keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','address','uint256[6][]','bytes32'],[COMMITMENT_DOMAIN,chainId,collection,buyer,selections,salt]));
}
export function maximumPayment(currentQuote,quantity,bufferMints){
  if(typeof currentQuote!=='bigint'||currentQuote<0n||!Number.isSafeInteger(quantity)||quantity<1||quantity>32||!Number.isSafeInteger(bufferMints)||bufferMints<0||bufferMints>MAX_BUFFER)throw Error('Invalid price buffer.');
  return currentQuote+STEP*BigInt(quantity)*BigInt(bufferMints);
}
export function intentPrefix({chainId,collection,buyer}){return `myfriends:mint-intent:v1:${chainId}:${collection.toLowerCase()}:${buyer.toLowerCase()}:`;}
export function intentKey(record){return intentPrefix(record)+record.hash;}
const resumeKey=domain=>`myfriends:mint-resume:v1:${domain.chainId}:${domain.collection.toLowerCase()}:${domain.buyer.toLowerCase()}:${domain.deploymentHash}`;
// Only a pointer; transaction evidence stays in the validated intent record.
export function rememberMint(store,record){try{store.storage.setItem(resumeKey(store.domain),record.hash);}catch{/* Existing intents remain recoverable. */}}
export function lastMint(store){
  try{
    const hash=store.storage.getItem(resumeKey(store.domain));
    if(HEX32.test(hash)){const record=store.read(hash);if(record&&record.state!=='expired')return record;}
  }catch{/* Invalid pointers cannot authorize or hide a saved transaction. */}
  const records=store.list().filter(r=>r.state!=='expired');
  return records.filter(r=>r.state!=='minted'&&(r.commitTx||r.revealTx)).at(-1)
    ||records.filter(r=>r.state!=='minted').at(-1)||records.at(-1)||null;
}
export function validateIntent(record,domain,counts){
  if(!record||record.version!==1||record.protocol!==MINT_PROTOCOL||!states.has(record.state)||typeof record.exposed!=='boolean')throw Error('Unsupported recovery record.');
  for(const key of ['chainId','collection','buyer','deploymentHash','codeHash'])if(String(record[key]).toLowerCase()!==String(domain[key]).toLowerCase())throw Error('Recovery belongs to a different wallet or deployment.');
  validateSelections(record.selections,counts);
  if(!HEX32.test(record.deploymentHash)||!HEX32.test(record.codeHash)||record.hash!==makeLocalCommitment(record))throw Error('Recovery verification failed.');
  for(const field of ['commitTx','revealTx']){
    const tx=record[field];if(tx!==null&&tx!==undefined){
      if(!Number.isSafeInteger(tx.nonce)||tx.nonce<0||!Number.isSafeInteger(tx.fromBlock)||tx.fromBlock<0||(tx.hash!==null&&!HEX32.test(tx.hash)))throw Error('Invalid recovery transaction.');
    }
  }
  const reviews=record.reviews??[];
  if(!Array.isArray(reviews)||reviews.length>20||reviews.some(q=>!q||!/^\d+$/.test(q.price)||!/^\d+$/.test(q.maximum)||!Number.isSafeInteger(q.deadline)||q.deadline<0||q.quantity!==record.selections.length||!Number.isSafeInteger(q.buffer)||q.buffer<0||q.buffer>MAX_BUFFER||BigInt(q.maximum)!==maximumPayment(BigInt(q.price),q.quantity,q.buffer)))throw Error('Invalid price review history.');
  // Select fields explicitly: recovery data never injects executable actions or arbitrary options.
  return {version:1,protocol:MINT_PROTOCOL,chainId:record.chainId,collection:record.collection,buyer:record.buyer,
    deploymentHash:record.deploymentHash,codeHash:record.codeHash,selections:record.selections.map(s=>[...s]),salt:record.salt,hash:record.hash,
    state:record.state,exposed:record.exposed,reviews,commitTx:record.commitTx??null,revealTx:record.revealTx??null};
}
export function createIntent(domain,selections,counts,{rng=globalThis.crypto,exposed=false}={}){
  validateSelections(selections,counts);if(!rng?.getRandomValues)throw Error('Secure randomness is unavailable.');
  const bytes=new Uint8Array(32);rng.getRandomValues(bytes);const salt=hexlify(bytes);
  const record={...domain,version:1,protocol:MINT_PROTOCOL,selections:selections.map(s=>[...s]),salt,state:'saved',exposed,reviews:[],commitTx:null,revealTx:null};
  record.hash=makeLocalCommitment(record);return validateIntent(record,domain,counts);
}
export class IntentStore {
  constructor(storage,domain,counts){this.storage=storage;this.domain=domain;this.counts=counts;}
  save(record){
    const checked=validateIntent(record,this.domain,this.counts),text=JSON.stringify(checked),key=intentKey(checked);
    try{this.storage.setItem(key,text);if(this.storage.getItem(key)!==text)throw Error();}
    catch{throw Error('Recovery could not be saved. Enable local storage before protecting your myFriend.');}
    return checked;
  }
  read(hash){const raw=this.storage.getItem(intentPrefix(this.domain)+hash);return raw?this.import(raw,false):null;}
  remove(record){
    const checked=validateIntent(record,this.domain,this.counts),key=intentKey(checked),pointer=resumeKey(this.domain);
    try{
      this.storage.removeItem(key);
      if(this.storage.getItem(key)!==null)throw Error();
      if(this.storage.getItem(pointer)===checked.hash)this.storage.removeItem(pointer);
      if(this.storage.getItem(pointer)===checked.hash)throw Error();
    }catch{throw Error('This saved mint could not be removed. Check browser storage and try again.');}
  }
  list(){
    const prefix=intentPrefix(this.domain),records=[];
    for(let i=0;i<this.storage.length;i++){const key=this.storage.key(i);if(key?.startsWith(prefix)){try{records.push(this.import(this.storage.getItem(key),false));}catch{/* Invalid records cannot authorize a transaction. */}}}
    return records;
  }
  import(text,save=true){
    if(typeof text!=='string'||text.length>32768)throw Error('Recovery file is too large or invalid.');
    let record;try{record=JSON.parse(text);}catch{throw Error('Invalid recovery JSON.');}
    let checked=validateIntent(record,this.domain,this.counts);
    if(save){
      const existing=this.read(checked.hash);
      if(existing)checked={...checked,state:existing.state,reviews:existing.reviews,exposed:existing.exposed||checked.exposed,commitTx:existing.commitTx??checked.commitTx,revealTx:existing.revealTx??checked.revealTx};
      return this.save(checked);
    }
    return checked;
  }
}
export function protectionState(timestamp,now){
  timestamp=BigInt(timestamp);now=BigInt(now);
  if(timestamp===0n)return 'missing';
  if(now>=timestamp+BigInt(MAX_AGE))return 'expired';
  return now<timestamp+BigInt(MIN_AGE)?'waiting':'ready';
}
