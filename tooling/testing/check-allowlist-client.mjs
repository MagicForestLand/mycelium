// Targeted fault-injection regression checks of the actual UI module. No keys or RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {keccak256,formatEther,toQuantity} from 'ethers';
import {ABI,chainInterface,allowlistMessage,deploymentKey,friendlyError,mintReceiptForGenotype,tokenExplorerURL,validateDeployment} from '../../apps/web/src/chain-core.js';
import {ChainReader} from '../../apps/web/src/chain-reader.js';
import {xComposerURL,xPostText} from '../../apps/web/src/x-share.js';

const buyer='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const address='0x3333333333333333333333333333333333333333';
const genotype=[1,2,3,4,1,2];
const deployment={id:'audit',label:'Audit',networkName:'Sepolia',chainId:11155111,address,
  rpcUrl:'https://example.invalid',deploymentBlock:1,deploymentHash:'0x'+'a'.repeat(64),codeHash:keccak256('0x1234'),
  catalogHash:'b'.repeat(64),mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1'};
const source=(await readFile(new URL('../../apps/web/src/chain-ui.js',import.meta.url),'utf8'))
  .replace(/^import .+;\n/gm,'')
  .replace(/^window\.myFriendsWeb3Ready=start\(\).*;\s*$/m,'');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function fixture(){
  const elements=new Map(),stored=new Map(),sent=[],listeners=new Map(),evidence=[];
  function element(){const events={},classes=new Set();return {dataset:{},hidden:false,open:false,children:[],classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains(name){return classes.has(name);}},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},focus(){},
    addEventListener(name,handler){events[name]=handler;},showModal(){this.open=true;},close(){this.open=false;events.close?.();},remove(){},
  };}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const controls={sendError:null,verify:async()=>{},allocation:3n,claimed:0n,nonce:async()=>7,send:async()=>{},wait:()=>new Promise(()=>{}),walletChain:deployment.chainId,switches:0};
  const readContract={salePhase:async()=>1n,mintPrice:async()=>0n,isAvailable:async()=>true,
    allowlistAllocation:async()=>controls.allocation,allowlistClaimed:async()=>controls.claimed,totalMinted:async()=>3n};
  const mint=Object.assign(async(...args)=>{sent.push(args);await controls.send();if(controls.sendError)throw controls.sendError;
    return {hash:'0x'+'c'.repeat(64),nonce:7,wait:()=>controls.wait()};
  },{staticCall:async()=>4n,estimateGas:async()=>150000n});
  class BrowserProvider{async getCode(){return '0x1234';}async getBlock(){return {hash:deployment.deploymentHash};}async getTransactionCount(){return controls.nonce();}async getSigner(){const address=api.getState().account;return {getAddress:async()=>address};}}
  class Contract{constructor(){return {mint};}}
  const ui={genotype:()=>[...genotype],owned:()=>reader.snapshot?.records||[],paint(){},markMinted(){},fresh(){},friends(){},
    confirmed(record){reader.snapshot.records.push({...record,tokenId:String(record.tokenId),name:'Mycelium Friend #'+record.tokenId});reader.snapshot.total=reader.snapshot.records.length;}};
  const context=vm.createContext({ABI,allowlistMessage,deploymentKey,friendlyError,mintReceiptForGenotype,tokenExplorerURL,validateDeployment,xComposerURL,xPostText,
    newMintEvidenceId:()=> '00000000-0000-4000-8000-000000000001',emitMintEvidence:(_url,event)=>{evidence.push(event);},
    BrowserProvider,Contract,keccak256,formatEther,toQuantity,URLSearchParams,Event,CustomEvent:class{},
    __TRAIT_COUNTS__:[32,128,32,16,4,32],__CATALOG_HASH__:deployment.catalogHash,__GENOTYPE_SPACE__:268435456,__CHAIN_CONFIG_PATH__:'',
    IntentStore:class{list(){return [];}},lastMint:()=>null,openProtectedMint:async()=>{},
    location:{hostname:'localhost',origin:'http://localhost',pathname:'/',protocol:'http:'},matchMedia:()=>({matches:true}),
    document:{getElementById:get,createElement:element,addEventListener(){}},
    window:{myFriendsUI:ui,addEventListener(name,handler){listeners.set(name,handler);},dispatchEvent(){}},
    localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{if(controls.storageFail)throw Error('Storage denied');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},console,
  });
  const api=await vm.runInContext(`(async()=>{${source}\nreturn {
    reviewMint,submitMint,onAccounts,onChain,finishReceipt,showError,checkPending,showPendingStatus,
    setPending(value){pending=value;},
    setup(d,r,w,a){deployment=d;reader=r;walletProvider=w;account=a;ready=true;walletChecking=false;},
    getState:()=>({busy,pending,account,quote,mintContext}),
    close(){document.getElementById('mintDialog').open=false;document.getElementById('mintDialog').close();}
  };})()`,context);
  const reader={snapshot:{blockNumber:98,total:0,salePhase:1,records:[]},contract:readContract,
    provider:{getBlockNumber:async()=>100,getTransactionCount:async()=>controls.confirmedNonce??0},verify:()=>controls.verify(),refresh:async()=>reader.snapshot};
  const walletProvider={request:async({method,params=[]})=>{
    if(method==='eth_chainId')return toQuantity(controls.walletChain);
    if(method==='wallet_switchEthereumChain'){
      controls.switches++;
      controls.walletChain=Number(params[0].chainId);
      api.onChain(params[0].chainId);
      return null;
    }
    return null;
  }};
  api.setup(deployment,reader,walletProvider,buyer);
  return {api,controls,sent,stored,elements,get,reader,ui,evidence};
}
export {fixture,deferred,buyer,other,genotype,address};

test('CHECK: exhausted allocation opens no wallet transaction',async()=>{
  const f=await fixture();f.controls.claimed=3n;
  await assert.rejects(f.api.reviewMint(),/Allowlist complete/);
  assert.equal(f.sent.length,0);
});
test('CHECK: user rejection releases the submission lock',async()=>{
  const f=await fixture();f.controls.sendError=Object.assign(Error('User rejected'),{code:4001});
  await assert.rejects(f.api.reviewMint(),/User rejected/);
  assert.equal(f.api.getState().busy,false);
});
test('CHECK: revoked allocation after prior claims has an actionable eligibility error',async()=>{
  const f=await fixture();f.controls.allocation=0n;f.controls.claimed=1n;
  await assert.rejects(f.api.reviewMint(),/no allowlist|Allowlist complete/);
});
test('CHECK: switching account during preflight aborts the original mint request',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();
  f.controls.verify=async()=>{entered.resolve();await release.promise;};
  const pending=f.api.reviewMint();await entered.promise;
  f.api.onAccounts([other]);release.resolve();
  await pending.catch(()=>{});
  assert.equal(f.sent.length,0,'Preflight silently continued with a different collecting wallet');
});
test('CHECK: switching chain during preflight aborts the wallet request',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();
  f.controls.verify=async()=>{entered.resolve();await release.promise;};
  const attempt=f.api.reviewMint();await entered.promise;
  f.api.onChain(toQuantity(1));release.resolve();await attempt.catch(()=>{});
  assert.equal(f.sent.length,0,'Preflight continued after the wallet changed chains');
});
test('CHECK: the requested wallet chain switch does not cancel its own mint review',async()=>{
  const f=await fixture();f.controls.walletChain=1;
  await f.api.reviewMint();
  assert.equal(f.controls.switches,1);
  assert.equal(f.sent.length,1,'The mint review was cancelled by its own requested chain change');
});
test('CHECK: closing the dialog during preflight prevents a new wallet request',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();
  f.controls.verify=async()=>{entered.resolve();await release.promise;};
  const pending=f.api.reviewMint();await entered.promise;
  f.api.close();release.resolve();await pending.catch(()=>{});
  assert.equal(f.sent.length,0,'Closed mint dialog reopened and requested a wallet transaction');
});
test('CHECK: uncertain broadcast remains locked and recoverable',async()=>{
  const f=await fixture();f.controls.sendError=Object.assign(Error('RPC response lost after broadcast'),{code:'NETWORK_ERROR'});
  let failure;try{await f.api.reviewMint();}catch(error){failure=error;}
  assert.match(failure?.message||'',/response lost/);
  assert.ok(f.api.getState().busy||f.api.getState().pending||f.stored.size>0,'No durable submission intent survives a lost send response');
  f.api.showError(failure);
  const clear=f.get('mintBody').children.find(child=>child.textContent==='I DID NOT APPROVE A TRANSACTION');
  assert.ok(clear,'An interrupted wallet response has no explicit recovery action');
  await clear.onclick();
  assert.equal(f.api.getState().pending,null,'Explicit recovery did not release the mint lock');
});
test('CHECK: unavailable browser storage fails before the wallet request',async()=>{
  const f=await fixture();f.controls.storageFail=true;
  await assert.rejects(f.api.reviewMint(),/storage is unavailable/);
  assert.equal(f.sent.length,0,'A wallet transaction was requested without durable recovery storage');
  assert.equal(f.api.getState().pending,null);
});
test('CHECK: unknown request unlocks after its nonce is confirmed without a matching mint',async()=>{
  const f=await fixture();f.controls.confirmedNonce=8;
  f.api.setPending({hash:null,state:'uncertain',buyer,genotype,tokenId:'4',nonce:7,createdAt:Date.now()});
  await f.api.checkPending();
  assert.equal(f.api.getState().pending,null,'A confirmed replacement or cancellation kept the mint permanently locked');
});
test('CHECK: after success, View My Friends includes the newly minted token',async()=>{
  const reader=new ChainReader(deployment,deployment.catalogHash,null);
  reader.provider.destroy();
  reader.snapshot={blockNumber:98,blockHash:deployment.deploymentHash,records:[],total:0,salePhase:1};
  reader.verify=async()=>{};
  // The mint receipt is in head block 100. Production reader chooses head - 2.
  reader.provider={getBlockNumber:async()=>100,getBlock:async()=>({hash:deployment.deploymentHash})};
  const state=await reader.read(()=>{});
  const f=await fixture();f.reader.snapshot=state;
  const hash='0x'+'c'.repeat(64);
  f.api.setPending({hash,buyer,genotype,tokenId:'1'});
  const packed=genotype.reduce((n,v,i)=>n|(BigInt(v)<<BigInt(i*8)),0n);
  const event=(name,args)=>({...chainInterface.encodeEventLog(chainInterface.getEvent(name),args),address});
  await f.api.finishReceipt({status:1,hash,blockNumber:100,logs:[event('GenotypeAssigned',[1,packed]),event('Transfer',['0x'+'0'.repeat(40),buyer,1])]});
  assert.equal(f.get('mintTitle').textContent,'Your myFriend is here!');
  assert.equal(f.ui.owned().length,1,'Success offers View My Friends while its history still excludes the successful mint');
});
