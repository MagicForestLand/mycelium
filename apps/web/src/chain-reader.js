import {Contract, JsonRpcProvider, FetchRequest, keccak256} from 'ethers';
import {ABI, CHAIN_CACHE_PREFIX, CHAIN_SNAPSHOT_VERSION, PRICE_STEP, chainInterface, appendMintLogs, deploymentKey, validateDeployment} from './chain-core.js';

const PROFILE_SOURCES=new Set(['manual','magic_forest','opensea']);
const PROFILE_ADDRESS=/^0x[\da-f]{40}$/;

export async function fetchMinterProfiles(url,{fetchImpl=fetch,timeoutMs=5000}={}){
  if(!url)return Object.create(null);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(`Profile API returned HTTP ${response.status}.`);
    const payload=await response.json();
    if(payload?.version!==1||!payload.profiles||typeof payload.profiles!=='object'||Array.isArray(payload.profiles))throw Error('Invalid minter profile response.');
    const entries=Object.entries(payload.profiles);
    if(entries.length>50_000)throw Error('Minter profile response is too large.');
    const profiles=Object.create(null);
    for(const [rawAddress,profile] of entries){
      const address=rawAddress.toLowerCase();
      if(!PROFILE_ADDRESS.test(address)||address!==rawAddress||!profile||typeof profile!=='object'||Array.isArray(profile))continue;
      const name=profile.displayName;
      if(typeof name!=='string'||!name.trim()||[...name.trim()].length>80||!PROFILE_SOURCES.has(profile.source))continue;
      const clean={displayName:name.trim(),source:profile.source};
      let valid=true;
      for(const [input,output] of [['profileUrl','profileUrl'],['avatarUrl','avatarUrl']])if(profile[input]!==undefined){try{
        const parsed=new URL(profile[input]);
        if(typeof profile[input]!=='string'||profile[input].length>2048||parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error();
        clean[output]=profile[input];
      }catch{valid=false;break;}}
      if(!valid)continue;
      profiles[address]=Object.freeze(clean);
    }
    const maximumExpiry=Date.now()+15*60_000;
    const expiresAt=Number.isSafeInteger(payload.expiresAt)&&payload.expiresAt>0?Math.min(payload.expiresAt,maximumExpiry):maximumExpiry;
    const safeProfiles=expiresAt<=Date.now()?Object.create(null):profiles;
    return Object.freeze({profiles:Object.freeze(safeProfiles),expiresAt});
  }finally{clearTimeout(timer);}
}

const hash=value=>typeof value==='string'&&/^0x[\da-f]{64}$/i.test(value);
const decimal=value=>typeof value==='string'&&/^\d{1,78}$/.test(value);
const address=value=>typeof value==='string'&&/^0x[\da-f]{40}$/i.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();

export function validateChainSnapshot(snapshot,deployment,genotypeSpace=Number.MAX_SAFE_INTEGER,traitCounts=[]) {
  if(snapshot?.version!==CHAIN_SNAPSHOT_VERSION||!Array.isArray(snapshot.records)||snapshot.records.length>genotypeSpace)throw Error('Invalid snapshot records.');
  if(!Number.isSafeInteger(snapshot.blockNumber)||snapshot.blockNumber<deployment.deploymentBlock||!hash(snapshot.blockHash))throw Error('Invalid snapshot block.');
  if(snapshot.total!==snapshot.records.length||!Number.isSafeInteger(snapshot.cap)||snapshot.cap<snapshot.total||snapshot.cap>genotypeSpace)throw Error('Invalid snapshot supply.');
  if(!Number.isSafeInteger(snapshot.publicMinted)||snapshot.publicMinted<0||!Number.isSafeInteger(snapshot.allowlistMinted)||snapshot.allowlistMinted<0||snapshot.publicMinted+snapshot.allowlistMinted!==snapshot.total)throw Error('Invalid snapshot mint counts.');
  if(typeof snapshot.publicOpen!=='boolean'||!Number.isInteger(snapshot.salePhase)||snapshot.salePhase<0||snapshot.salePhase>3||snapshot.publicOpen!==(snapshot.salePhase===2||snapshot.salePhase===3))throw Error('Invalid snapshot sale phase.');
  const expectedPrice=snapshot.publicOpen?PRICE_STEP*BigInt(snapshot.publicMinted):0n;
  if(!decimal(snapshot.price)||BigInt(snapshot.price)!==expectedPrice)throw Error('Invalid snapshot price.');
  if(!Number.isSafeInteger(snapshot.updatedAt)||snapshot.updatedAt<0)throw Error('Invalid snapshot timestamp.');
  const genotypes=new Set();let publicCount=0,allowlistCount=0,publicStarted=false;
  snapshot.records.forEach((record,index)=>{
    if(record?.tokenId!==String(index+1)||!decimal(record.price)||!['public','allowlist'].includes(record.phase)||!hash(record.transactionHash)||!address(record.buyer)||!address(record.owner))throw Error('Invalid snapshot mint record.');
    if(!Number.isSafeInteger(record.blockNumber)||record.blockNumber<deployment.deploymentBlock||record.blockNumber>snapshot.blockNumber)throw Error('Invalid snapshot mint block.');
    if(!Array.isArray(record.genotype)||record.genotype.length!==6||record.genotype.some((value,layer)=>!Number.isSafeInteger(value)||value<0||value>=(traitCounts[layer]??256)))throw Error('Invalid snapshot genotype.');
    const genotype=record.genotype.join(',');if(genotypes.has(genotype))throw Error('Duplicate snapshot genotype.');genotypes.add(genotype);
    if(record.phase==='public'){
      publicStarted=true;publicCount++;
      if(record.step!==publicCount||BigInt(record.price)!==PRICE_STEP*BigInt(publicCount-1))throw Error('Invalid snapshot public pricing.');
    }else{
      if(publicStarted||record.step!==0)throw Error('Invalid snapshot allowlist order.');
      allowlistCount++;
    }
  });
  if(publicCount!==snapshot.publicMinted||allowlistCount!==snapshot.allowlistMinted)throw Error('Snapshot phase counts do not match.');
  return snapshot;
}

export function snapshotFromEnvelope(envelope,deployment,genotypeSpace=Number.MAX_SAFE_INTEGER,traitCounts=[]) {
  const remote=envelope?.deployment;
  if(envelope?.version!==CHAIN_SNAPSHOT_VERSION||!remote||remote.id!==deployment.id||remote.chainId!==deployment.chainId||!same(remote.address,deployment.address)||remote.deploymentBlock!==deployment.deploymentBlock||!same(remote.deploymentHash,deployment.deploymentHash)||!same(remote.codeHash,deployment.codeHash)||!same(remote.catalogHash,deployment.catalogHash))throw Error('Snapshot deployment does not match this collection.');
  return validateChainSnapshot(envelope.snapshot,deployment,genotypeSpace,traitCounts);
}

export async function fetchAndSeedSnapshot(reader,url,{fetchImpl=globalThis.fetch,timeoutMs=2500,maxBlockLag=128,replace=false}={}) {
  if(typeof fetchImpl!=='function')throw Error('Snapshot fetch is unavailable.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{headers:{accept:'application/json'},signal:controller.signal});
    if(!response.ok){
      const error=Error('Snapshot API unavailable.');error.status=Number(response.status)||0;
      const retryAfter=response.headers?.get?.('retry-after');
      if(typeof retryAfter==='string'&&retryAfter.trim()){
        const trimmed=retryAfter.trim(),seconds=/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)?Number(trimmed):NaN;
        if(Number.isFinite(seconds))error.retryAfterMs=Math.min(60_000,Math.max(1_000,seconds*1_000));
        else {const retryAt=Date.parse(trimmed);if(Number.isFinite(retryAt))error.retryAfterMs=Math.min(60_000,Math.max(1_000,retryAt-Date.now()));}
      }
      throw error;
    }
    const envelope=await response.json();
    const snapshot=snapshotFromEnvelope(envelope,reader.deployment,reader.genotypeSpace,reader.traitCounts);
    const [head,block]=await Promise.all([reader.provider.getBlockNumber(),reader.provider.getBlock(snapshot.blockNumber)]);
    if(snapshot.blockNumber>head||head-snapshot.blockNumber>maxBlockLag)throw Error('Snapshot API response is stale.');
    if(!block||!same(block.hash,snapshot.blockHash))throw Error('Snapshot API block is not canonical.');
    return reader.seedSnapshot(envelope,{replace});
  }finally{clearTimeout(timeout);}
}

export class ChainReader {
  constructor(deployment, catalogHash, storage, genotypeSpace=Number.MAX_SAFE_INTEGER,traitCounts=[]) {
    this.deployment=validateDeployment(deployment);
    if (deployment.catalogHash!==catalogHash) throw Error('This deployment uses a different artwork catalog. Rebuild the site for this release.');
    if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
    this.storage=storage; this.key=deploymentKey(deployment);this.genotypeSpace=genotypeSpace;this.traitCounts=traitCounts;
    const request=new FetchRequest(deployment.rpcUrl); request.timeout=30_000;
    this.provider=new JsonRpcProvider(request, undefined, {batchMaxCount:12,cacheTimeout:-1});
    this.contract=new Contract(deployment.address,ABI,this.provider);
    this.snapshot=null; this.inflight=null; this.verified=false;
    try {
      const cached=JSON.parse(storage?.getItem(this.key));
      this.snapshot=validateChainSnapshot(cached,deployment,genotypeSpace,traitCounts);
    } catch {}
  }
  seedSnapshot(envelope,{replace=false}={}) {
    const snapshot=snapshotFromEnvelope(envelope,this.deployment,this.genotypeSpace,this.traitCounts);
    if(this.snapshot&&(
      this.snapshot.blockNumber>snapshot.blockNumber||
      (!replace&&this.snapshot.blockNumber===snapshot.blockNumber)
    ))return false;
    this.snapshot=snapshot;this.persist(snapshot);return true;
  }
  persist(snapshot) {
    try {
      const encoded=JSON.stringify(snapshot);
      if(encoded.length>=2_000_000)return;
      this.storage?.setItem(this.key,encoded);
      const histories=[];for(let i=this.storage?.length-1;i>=0;i--){const key=this.storage.key(i);if(key?.startsWith(CHAIN_CACHE_PREFIX)){let updatedAt=0;try{updatedAt=JSON.parse(this.storage.getItem(key))?.updatedAt||0;}catch{}histories.push({key,updatedAt});}}
      histories.sort((a,b)=>b.updatedAt-a.updatedAt);for(const item of histories.slice(4))this.storage.removeItem(item.key);
    } catch { /* Private browsing / quota: memory cache is enough. */ }
  }
  async verify(force=false) {
    if(this.verified&&!force)return;
    const d=this.deployment;
    const [network,code,block]=await Promise.all([this.provider.getNetwork(),this.provider.getCode(d.address),this.provider.getBlock(d.deploymentBlock)]);
    if (Number(network.chainId)!==d.chainId || !block || block.hash!==d.deploymentHash || code==='0x' || keccak256(code)!==d.codeHash) {
      this.verified=false; this.snapshot=null;try {this.storage?.removeItem(this.key);} catch {}
      throw Error('The chain or collection changed. Select the current deployment and reload.');
    }
    this.verified=true;
  }
  refresh(onProgress=()=>{}) {
    if (this.inflight) return this.inflight;
    this.inflight=this.read(onProgress).finally(()=>{this.inflight=null;});return this.inflight;
  }
  async read(onProgress) {
    await this.verify();
    const head=await this.provider.getBlockNumber();
    const end=Math.max(this.deployment.deploymentBlock,head-(this.deployment.chainId===31337?0:2));
    let state=this.snapshot;
    if (state && (state.blockNumber>end || (await this.provider.getBlock(state.blockNumber))?.hash!==state.blockHash)) {
      state=null;this.snapshot=null;try{this.storage?.removeItem(this.key);}catch{}
    }
    if(state&&state.blockNumber===end)return state;
    const opts={blockTag:end};
    const [total,cap,publicMinted,allowlistMinted,salePhase,block]=await Promise.all([
      this.contract.totalMinted(opts),this.contract.saleCap(opts),this.contract.publicMinted(opts),
      this.contract.allowlistMinted(opts),this.contract.salePhase(opts),this.provider.getBlock(end)
    ]);
    const phase=Number(salePhase),publicOpen=phase===2||phase===3;
    const price=publicOpen?PRICE_STEP*publicMinted:0n;
    // A freshly deployed, closed collection can remain at zero for months. The
    // canonical counter proves that there is no mint/transfer history to build,
    // so a first visit need not scan every empty post-deployment block.
    if(!state&&total===0n){
      if(publicMinted!==0n||allowlistMinted!==0n)throw Error('The collection counters are inconsistent. Please retry.');
      const snapshot={version:CHAIN_SNAPSHOT_VERSION,records:[],publicOpen,salePhase:phase,total:0,cap:Number(cap),publicMinted:0,allowlistMinted:0,
        price:price.toString(),blockNumber:end,blockHash:block.hash,updatedAt:Date.now()};
      validateChainSnapshot(snapshot,this.deployment,this.genotypeSpace,this.traitCounts);
      this.snapshot=snapshot;this.persist(snapshot);return snapshot;
    }
    if(!state&&total>0n&&this.deployment.chainId!==31337)throw Error('A verified collection snapshot is required before public history can be synchronized.');
    state=state ? {...state,records:[...state.records]} : {records:[],publicOpen:false,blockNumber:this.deployment.deploymentBlock-1};
    const topics=[[...['Minted','GenotypeAssigned','PublicSaleOpened','Transfer'].map(name=>chainInterface.getEvent(name).topicHash)]];
    const ranges=[];
    for(let from=state.blockNumber+1;from<=end;from+=1000)ranges.push({from,to:Math.min(end,from+999)});
    // A new browser may have several empty post-deployment ranges to index. Read a
    // small bounded group concurrently, then apply it in block order so the event
    // state machine stays deterministic without making first load unnecessarily slow.
    for(let offset=0;offset<ranges.length;offset+=6){
      const group=await Promise.all(ranges.slice(offset,offset+6).map(async range=>({
        ...range,logs:await this.provider.getLogs({address:this.deployment.address,fromBlock:range.from,toBlock:range.to,topics})
      })));
      for(const {to,logs} of group){Object.assign(state,appendMintLogs(state,logs));onProgress(to,end);}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if (Number(total)!==state.records.length || publicOpen!==state.publicOpen) {this.snapshot=null;throw Error('The history changed during sync. Please retry.');}
    const snapshot={version:CHAIN_SNAPSHOT_VERSION,records:state.records,publicOpen,salePhase:phase,total:Number(total),cap:Number(cap),publicMinted:Number(publicMinted),allowlistMinted:Number(allowlistMinted),
      price:price.toString(),blockNumber:end,blockHash:block.hash,updatedAt:Date.now()};
    validateChainSnapshot(snapshot,this.deployment,this.genotypeSpace,this.traitCounts);
    this.snapshot=snapshot;
    this.persist(snapshot);
    return snapshot;
  }
  destroy() {this.provider.destroy();}
}
