import {withCommitReveal} from '../lib/protected-test-client.mjs';
// Real production contracts and transactions; EIP-1193 wallet transport is controlled
// for deterministic rejection, account-change and wrong-network browser checks.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JsonRpcProvider,ContractFactory,Contract,keccak256,ZeroAddress} from 'ethers';
import {compileContracts} from '../lib/compile-contracts.mjs';
import {catalogFingerprint} from '../lib/deployment-plan.mjs';
import {ChainReader} from '../../apps/web/src/chain-reader.js';
import {renderSVG,editions} from '../../collection/source/art.js';

if(process.argv.includes('--inspect')){
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  try{const page=await browser.newPage();page.on('pageerror',e=>console.log('BROWSER ERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
    await page.setViewport({width:1440,height:1000});await page.goto('http://127.0.0.1:4173/');await new Promise(r=>setTimeout(r,3000));
    const chunksBefore=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/web3/chunk-')).length);
    await page.click('#wallet');await page.click('#mintBody .chain-action');await page.waitForSelector('w3m-modal',{timeout:20_000});await new Promise(r=>setTimeout(r,2500));
    console.log(await page.evaluate(chunksBefore=>({status:document.querySelector('#chainStatus')?.textContent,ready:document.body.dataset.ready,ui:!!window.myFriendsUI,mint:document.querySelector('#mint')?.textContent,summary:document.querySelector('#summaryCurrent')?.textContent,appKitModal:!!document.querySelector('w3m-modal'),appKitOpen:document.querySelector('w3m-modal')?.open,chunksBefore,chunksAfter:performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/web3/chunk-')).length}),chunksBefore));
    await page.screenshot({path:path.join(os.tmpdir(),'myfriends-inspect.png')});
    for(const width of [1440,390,320]){
      await page.setViewport({width,height:width>640?1000:844});
      const before=await page.$eval('#mintDialog',node=>{const r=node.getBoundingClientRect();return [r.width,r.height];});
      const state=await page.evaluate(()=>{const d=document.querySelector('#mintDialog'),p=document.querySelector('#mintPreview').getBoundingClientRect(),w=document.querySelector('w3m-modal').getBoundingClientRect(),r=d.getBoundingClientRect();return {inside:p.top>=r.top&&p.bottom<=r.bottom,walletInside:w.left>=r.left&&w.right<=r.right,overflow:d.scrollWidth>d.clientWidth};});
      assert.deepEqual(state,{inside:true,walletInside:true,overflow:false});
      if(width===390){await mkdir('output/previews/site-ui/mobile',{recursive:true});await page.screenshot({path:'output/previews/site-ui/mobile/walletconnect.png'});}
      assert.deepEqual(await page.$eval('#mintDialog',node=>{const r=node.getBoundingClientRect();return [r.width,r.height];}),before);
    }
    console.log('PASS: embedded wallet selection stays inside the same dialog at 1440, 390 and 320px; artwork remains visible.');
  }finally{await browser.close();}process.exit(0);
}

let provider,browser,page,temp,browserProcess,browserHeartbeat,failure=null;
const errors=[];
try{
provider=new JsonRpcProvider('http://127.0.0.1:8545',undefined,{cacheTimeout:-1});provider.pollingInterval=100;
assert.equal(Number((await provider.getNetwork()).chainId),31337);
const config=JSON.parse(await readFile(new URL('../../apps/web/chain-config.json',import.meta.url)));
const existing=config.deployments.find(d=>d.chainId===31337);
if(!existing)throw Error('No local deployment is configured. Run npm run local:chain and npm run local:deploy before npm run test:browser.');
const source=new Contract(existing.address,['function genotypeDescriptor() view returns(address)','function phenotypeRenderer() view returns(address)'],provider);
const signer=await provider.getSigner(),owner=await signer.getAddress(),buyer=await(await provider.getSigner(1)).getAddress();
console.log('Compiling isolated browser-test collections…');
const {compiled}=compileContracts({fixtures:false});
const artifact=compiled.contracts['contracts/core/MyceliumFriends.sol'].MyceliumFriends;
const fixtureConfig={version:1,projectId:'',deployments:[]};
const contracts={},local={request:({method,params=[]})=>provider.send(method,params)};
for(const scenario of ['public','allowlist','spiral']){
  const nft=withCommitReveal(await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(await source.genotypeDescriptor(),await source.phenotypeRenderer(),owner,owner,1000,owner),local);
  const receipt=await nft.deploymentTransaction().wait(),address=await nft.getAddress();contracts[scenario]=nft;
  await(await nft.setAllowlistAllocations([owner,buyer],[5,2])).wait();
  await(await nft.startAllowlistSale()).wait();
  if(scenario==='spiral')for(const e of editions.slice(0,3))await(await nft.mint(...e.genotype)).wait();
  if(scenario!=='allowlist')await(await nft.openPublicSale()).wait();
  if(scenario==='spiral')for(const e of editions.slice(3,13))await(await nft.mint(...e.genotype,{value:await nft.mintPrice(1)})).wait();
  fixtureConfig.deployments.push({id:'check-'+scenario,label:'Browser check · '+scenario,scenario,mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,networkName:'myFriends Local',address,
    rpcUrl:'http://127.0.0.1:8545',deploymentBlock:receipt.blockNumber,deploymentHash:(await provider.getBlock(receipt.blockNumber)).hash,
    codeHash:keccak256(await provider.getCode(address)),catalogHash:catalogFingerprint().sha256});
}
fixtureConfig.activeDeployment='check-public';
const storage=new Map(),memory={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const reader=new ChainReader(fixtureConfig.deployments[2],catalogFingerprint().sha256,memory);
const first=await reader.refresh();assert.equal(first.records.length,13);assert.equal(first.publicMinted,10);assert.equal(first.price,'1000000000000000');
assert.equal(first.records.reduce((sum,r)=>sum+BigInt(r.price),0n),4500000000000000n);
const second=await reader.refresh();assert.equal(second.records.length,13);
const reloaded=new ChainReader(fixtureConfig.deployments[2],catalogFingerprint().sha256,memory);assert.equal(reloaded.snapshot.records.length,13);
await reloaded.refresh();assert.equal(reloaded.snapshot.records.length,13);
reader.destroy();reloaded.destroy();
console.log('PASS event indexing / incremental reads / cache reload / private-public pricing');

temp=await mkdtemp(path.join(os.tmpdir(),'myfriends-web3-'));
await Promise.all([mkdir('output/previews/site-ui/desktop',{recursive:true}),mkdir('output/previews/site-ui/mobile',{recursive:true})]);
browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox'],userDataDir:temp});
browserProcess=browser.process();
const checks=[];page=await browser.newPage();
const browserStarted=Date.now();let browserStage='wallet connection and first mint';
browserHeartbeat=setInterval(()=>console.log(`WORKING: browser E2E · ${browserStage} · ${Math.round((Date.now()-browserStarted)/1000)}s elapsed`),20_000);
browserHeartbeat.unref();
const stage=label=>{browserStage=label;console.log(`RUN: browser E2E · ${label}`);};
const pass=label=>{checks.push(label);console.log(`PASS: ${label}`);};
page.on('pageerror',error=>errors.push(error.message));
let offline=false,transactions=0;
await page.setRequestInterception(true);
page.on('request',request=>{
  if(request.url().endsWith('/chain-config.json'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify(fixtureConfig)});
  if(request.url().startsWith('http://127.0.0.1:8545')&&offline)return request.abort('failed');
  if(request.url().includes('api.coingecko.com'))return request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})});
  return request.continue();
});
await page.exposeFunction('testWalletRPC',async({method,params=[]})=>{if(method==='eth_sendTransaction')transactions++;return provider.send(method,params);});
await page.evaluateOnNewDocument(({buyer})=>{
  const listeners={};window.testWallet={account:buyer,connected:sessionStorage.getItem('test-wallet-connected')==='yes',chain:'0x1',reject:false,switches:0};
  const emit=(event,arg)=>(listeners[event]||[]).forEach(fn=>fn(arg));window.testEmit=emit;
  window.ethereum={
    on(event,fn){(listeners[event]||=[]).push(fn);},removeListener(event,fn){listeners[event]=(listeners[event]||[]).filter(f=>f!==fn);},
    async request({method,params=[]}){
      const w=window.testWallet;
      if(method==='eth_requestAccounts'){w.connected=true;sessionStorage.setItem('test-wallet-connected','yes');return [w.account];}
      if(method==='eth_accounts')return w.connected?[w.account]:[];
      if(method==='eth_chainId')return w.chain;
      if(method==='wallet_switchEthereumChain'){w.switches++;w.chain=params[0].chainId;emit('chainChanged',w.chain);return null;}
      if(method==='eth_sendTransaction'&&w.reject){w.reject=false;throw Object.assign(Error('User rejected'),{code:4001});}
      return window.testWalletRPC({method,params});
    }
  };
  const announce=()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'test-wallet',name:'Test EIP-6963 wallet',rdns:'test.wallet'},provider:window.ethereum}}));
  addEventListener('eip6963:requestProvider',announce);announce();
},{buyer});
const home=process.env.SITE_URL||'http://127.0.0.1:4173/';
async function synced(){await page.waitForFunction(()=>document.querySelector('#chainStatus')?.dataset.ready==='true',{timeout:30_000});}
async function selectScenario(name){await page.select('#deploymentSelect','check-'+name);await page.waitForFunction(name=>document.querySelector('#deploymentSelect').value==='check-'+name,{},name);await synced();}
async function selectGenotype(g){await page.evaluate(g=>{location.hash='#genotype='+g.join(',');},g);await page.waitForFunction(g=>document.querySelector('#preview').dataset.genotype===g.join(','),{},g);}
async function clickAction(text){
 await page.waitForFunction(t=>[...document.querySelectorAll('#mintBody button')].some(b=>b.textContent.includes(t)&&!b.disabled),{},text);
 await page.evaluate(t=>[...document.querySelectorAll('#mintBody button')].find(b=>b.textContent.includes(t)).click(),text);
}
async function review({mature=true}={}){
 await page.click('#mint');await page.waitForFunction(()=>['start','waiting','ready'].includes(document.querySelector('#mintBody').dataset.mintScreen));
 expectedPreview=await page.$eval('#preview',node=>node.dataset.genotype);
 if(mature){
   if(!await page.$eval('#mintBody',n=>n.dataset.mintScreen==='ready')){
     if(await page.$eval('#mintBody',n=>n.dataset.mintScreen==='start'))await clickAction('PREPARE MY MINT');
     await page.waitForFunction(()=>['waiting','ready'].includes(document.querySelector('#mintBody').dataset.mintScreen));
     if(await page.$eval('#mintBody',n=>n.dataset.mintScreen==='waiting')){
       await provider.send('evm_increaseTime',[60]);await provider.send('evm_mine',[]);
     }
   }
   await page.waitForFunction(()=>document.querySelector('#mintBody').dataset.mintScreen==='ready');
 }
 await checkDialog();
}
async function confirm(){await page.waitForSelector('#mintBody .chain-action:not(:disabled)');await page.click('#mintBody .chain-action:not(:disabled)');}
let expectedDialog=null,expectedPreview=null;
async function checkDialog(){
 const state=await page.evaluate(()=>{const dialog=document.querySelector('#mintDialog'),d=dialog.getBoundingClientRect(),p=document.querySelector('#mintPreview').getBoundingClientRect();return {box:[d.x,d.y,d.width,d.height],preview:document.querySelector('#mintPreview').dataset.genotype,visible:p.top>=d.top&&p.bottom<=d.bottom,className:dialog.className,screen:document.querySelector('#mintBody').dataset.mintScreen||null};});
 if(expectedDialog)assert.deepEqual(state.box,expectedDialog,`Mint dialog resized between stages (${JSON.stringify({className:state.className,screen:state.screen})})`);else expectedDialog=state.box;
 assert.equal(state.visible,true);if(expectedPreview)assert.equal(state.preview,expectedPreview);return state;
}
async function success(){
 await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your myFriend is here!',{timeout:30_000});
 await checkDialog();assert.equal(await page.$$eval('.mint-downloads button',nodes=>nodes.length),3);
 assert.equal(await page.$$eval('#mintBody .chain-action',nodes=>nodes.some(node=>node.textContent==='VIEW MY FRIENDS')),true);
 assert.match(await page.$eval('#shareMint',node=>node.href),/^https:\/\/x.com\/intent\/tweet/);
 const xComposer=new URL(await page.$eval('#shareMint',node=>node.href));assert.equal(xComposer.searchParams.has('url'),false);assert.match(xComposer.searchParams.get('text'),/myFriend #\d+/);
 assert.equal(await page.$$eval('#shareMintImage, #copyMintLink',nodes=>nodes.length),2);
 const details=await page.$eval('#mintDetails',node=>node.textContent);assert.ok(details.includes(buyer));assert.equal(details.includes('…'),false);
 if(transactions===2){assert.equal(await page.$$eval('#mintCelebration i',nodes=>nodes.length),48);await page.screenshot({path:'output/previews/site-ui/desktop/mint-success.png'});}
 if(page.viewport().width===390)await page.screenshot({path:'output/previews/site-ui/mobile/mint-success.png'});
 await page.click('#closeMint');await synced();assert.notEqual(await page.$eval('#preview',node=>node.dataset.genotype),expectedPreview);expectedPreview=null;
}
  stage(browserStage);
  await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  await page.goto(home);await synced();
  assert.match(await page.$eval('#summaryCurrent',el=>el.textContent),/^0\.00000 ETH\(\$0\.00\)$/);
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),0);
  await page.waitForFunction(()=>['current','future','done'].includes(document.body.dataset.spiralIntro),{timeout:15_000});
  assert.equal(await page.$$eval('#nodes .node canvas',els=>els.length),1);
  assert.equal(await page.$eval('.brand-small',el=>el.textContent),'myFriends by Magic Forest');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const networkRequests=[];page.on('request',r=>networkRequests.push(r.url()));
  await page.click('#wallet');await clickAction('Test EIP-6963 wallet');
  await page.waitForFunction(()=>document.querySelector('#wallet').dataset.state==='connected');
  await page.waitForFunction(()=>document.body.dataset.view==='spiral'&&document.body.dataset.mobileSurface==='builder');
  assert.equal(await page.$eval('#wallet',node=>node.textContent),'WALLET MENU');
  assert.equal(networkRequests.some(u=>/wallet-appkit|chunk-EYJS/.test(u)),false);
  await selectGenotype([0,0,0,0,0,0]);await review({mature:false});
  assert.equal(await page.evaluate(()=>window.testWallet.switches),1);
  await page.evaluate(()=>window.testWallet.reject=true);await confirm();
  await page.waitForFunction(()=>document.querySelector('#mintBody').textContent.includes('You cancelled in your wallet'));
  assert.equal(transactions,0);await checkDialog();await page.click('#closeMint');
  await review();await confirm();await success();
  assert.equal(await contracts.public.ownerOf(1),buyer);assert.equal(await contracts.public.totalMinted(),1n);
  await page.click('#wallet');await clickAction('DISCONNECT WALLET');
  await page.waitForFunction(()=>document.querySelector('#wallet').dataset.state==='disconnected'&&!document.querySelector('#mintDialog').open);
  await page.click('#wallet');await clickAction('Test EIP-6963 wallet');
  await page.waitForFunction(()=>!document.querySelector('#myfriends-view').hidden&&document.querySelectorAll('#myfriends-gallery .forest-card').length===1);
  pass('EIP-6963 connection, wrong-chain switch, rejection with no transaction, sequential free mint ID one and receipt success');
  stage('availability, price and public pause/resume');
  await page.click('#retryChain');await synced();
  assert.match(await page.$eval('#summaryCurrent',el=>el.textContent),/^0\.00010 ETH\(.+\)$/);
  await selectGenotype([0,0,0,0,0,0]);
  assert.equal(await page.$eval('#mint',el=>el.disabled),true);
  assert.match(await page.$eval('.availability-note',el=>el.textContent),/lives in your wallet|found a home/i);
  await selectGenotype([1,0,0,0,0,0]);await review();await confirm();await success();
  assert.equal(await contracts.public.totalMinted(),2n);
  pass('Taken combination blocks mint; next mint pays the exact contract price');

  // Public pause changes UI state without freezing existing history or resetting the spiral price.
  await selectGenotype([4,0,0,0,0,0]);
  const priceBeforePause=await contracts.public.mintPrice(1),mintedBeforePause=await contracts.public.publicMinted();
  await(await contracts.public.pausePublicSale()).wait();await page.click('#retryChain');
  await page.waitForFunction(()=>/Public mint paused/.test(document.querySelector('#chainStatus')?.textContent||''),{timeout:30_000});
  assert.equal(await page.$eval('#mint',el=>el.disabled),true);
  assert.match(await page.$eval('#mint',el=>el.textContent),/PUBLIC MINT PAUSED/);
  assert.equal(await contracts.public.mintPrice(1),priceBeforePause);assert.equal(await contracts.public.publicMinted(),mintedBeforePause);
  await(await contracts.public.resumePublicSale()).wait();await page.click('#retryChain');
  await page.waitForFunction(()=>/Public mint open/.test(document.querySelector('#chainStatus')?.textContent||'')&&!document.querySelector('#mint')?.disabled,{timeout:30_000});
  assert.match(await page.$eval('.builder-price-head',el=>el.textContent),/PUBLIC MINT/);
  pass('Public pause disables mint UI and resume restores the same spiral position');
  stage('history races, pending recovery and reorg handling');

  // Availability is learned from general public history, without a selected-DNA RPC.
  const availabilityRace=await provider.send('evm_snapshot',[]),raceGenotype=[7,0,0,0,0,0];
  await(await contracts.public.mint(...raceGenotype,{value:await contracts.public.mintPrice(1)})).wait();
  const sentBeforeRace=transactions;await page.click('#retryChain');await synced();await selectGenotype(raceGenotype);
  assert.equal(await page.$eval('#mint',el=>el.disabled),true);assert.equal(transactions,sentBeforeRace);
  await provider.send('evm_revert',[availabilityRace]);await page.reload();await synced();
  pass('General public history marks a taken selection without targeted pre-maturity availability calls');

  // Hold a real transaction in Ganache's mempool, reload, then resume mining.
  await selectGenotype([2,0,0,0,0,0]);await review();
  await provider.send('miner_stop',[]);
  try{
    await confirm();await page.waitForFunction(()=>document.querySelector('#mintBody').dataset.mintScreen==='pending-reveal');
    await checkDialog();
    const sent=transactions;
    await page.click('#closeMint');await selectGenotype([9,3,2,1,0,0]);
    await page.reload();await synced();
    assert.equal(await page.$('#viewMint'),null);
    await page.click('#wallet');await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet'&&document.querySelector('.wallet-mint-mini'));
    await page.click('.wallet-mint-mini');await page.waitForFunction(()=>document.querySelector('#mintBody')?.dataset.mintScreen==='pending-reveal');await checkDialog();
    await provider.send('miner_start',[1]);await success();
    assert.equal(transactions,sent);assert.equal(await contracts.public.ownerOf(3),buyer);
  }finally{await provider.send('miner_start',[1]);}
  pass('Pending transaction survives reload; confirmation resumes with no duplicate submission');

  // Reorg recovery: a reverted local branch must disappear from cached history.
  const branch=await provider.send('evm_snapshot',[]);
  const branchReader=new ChainReader(fixtureConfig.deployments[0],catalogFingerprint().sha256,memory);
  await branchReader.refresh();const beforeBranch=branchReader.snapshot.records.length;
  await(await contracts.public.mint(3,0,0,0,0,0,{value:await contracts.public.mintPrice(1)})).wait();
  await branchReader.refresh();assert.equal(branchReader.snapshot.records.length,beforeBranch+1);
  await provider.send('evm_revert',[branch]);await branchReader.refresh();assert.equal(branchReader.snapshot.records.length,beforeBranch);branchReader.destroy();
  pass('Local chain reorg invalidates cached branch and rebuilds the correct mint history');
  stage('allowlist, on-chain artwork and offline cache');

  await selectScenario('allowlist');expectedDialog=null;assert.equal(await page.$('.allowlist-wallet-note'),null);
  await selectGenotype([0,0,0,0,0,0]);expectedPreview=await page.$eval('#preview',node=>node.dataset.genotype);await page.click('#mint');await success();
  await selectGenotype([1,0,0,0,0,0]);expectedPreview=await page.$eval('#preview',node=>node.dataset.genotype);await page.click('#mint');await success();
  await selectGenotype([2,0,0,0,0,0]);const sentBeforeQuotaCheck=transactions;
  assert.equal(await page.$eval('#mint',node=>node.disabled),false);
  await page.click('#mint');
  await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your allowlist is complete');
  assert.equal(await page.$eval('#mintEyebrow',node=>node.textContent),'ALLOWLIST STATUS');
  assert.equal(await page.$eval('#mintArtCaption',node=>node.textContent),'Your saved myFriend is still here.');
  assert.match(await page.$eval('#mintBody',node=>node.textContent),/Allowlist complete · 2 of 2/);
  assert.equal(await page.$$eval('.wallet-friend-mini',nodes=>nodes.length),2);
  assert.deepEqual(await page.$$eval('#mintBody .chain-action',nodes=>nodes.map(node=>node.textContent)),['VIEW MY FRIENDS','CONNECT ANOTHER WALLET']);
  assert.equal(transactions,sentBeforeQuotaCheck);await page.click('#closeMint');
  await page.click('#toggleWishlist');
  await page.click('.top-links [data-view="wishlist"]');await page.waitForFunction(()=>!document.querySelector('#wishlist-view').hidden);
  assert.equal(await page.$eval('#wishlist-gallery [data-wishlist-mint]',node=>node.disabled),false);
  await page.click('#wishlist-gallery [data-wishlist-mint]');
  await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your allowlist is complete');
  assert.deepEqual(await page.$$eval('#mintBody .chain-action',nodes=>nodes.map(node=>node.textContent)),['VIEW MY FRIENDS','CONNECT ANOTHER WALLET']);
  assert.equal(transactions,sentBeforeQuotaCheck);await page.click('#closeMint');
  await page.click('#wallet');await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your wallet');
  assert.equal(await page.$eval('#mintEyebrow',node=>node.textContent),'YOUR CONNECTED WALLET');
  assert.equal(await page.$$eval('.wallet-friend-mini',nodes=>nodes.length),2);
  assert.equal(await page.$$eval('.wallet-friend-mini canvas',nodes=>nodes.every(node=>{
    const box=node.getBoundingClientRect();
    return node.width===400&&node.height===400&&box.width===78&&box.height===78;
  })),true);
  await clickAction('VIEW MY FRIENDS');assert.equal(await page.$$eval('#myfriends-gallery .forest-card',nodes=>nodes.length),2);
  assert.equal(await page.$('#myfriends-allowlist'),null);
  await page.click('#myfriends-gallery .forest-card');
  assert.equal(await page.$eval('#myfriends-view',node=>node.hidden),false);
  assert.match(await page.$eval('#contextPanel h2',node=>node.textContent),/^Mycelium Friend #1$/);
  assert.equal(await page.$eval('#previewOwnership',node=>!node.hidden&&node.classList.contains('is-owned')&&Boolean(node.querySelector('svg'))),true);
  assert.equal(await page.$eval('#backBuild',node=>node.textContent),'← BUILD FROM THESE TRAITS');
  await page.click('#backBuild');
  assert.equal(await page.$eval('#mint',node=>node.textContent.includes('✓')),false);
  assert.match(await page.$eval('.availability-note',node=>node.textContent),/lives in your wallet/);
  assert.equal(await page.$eval('#viewOwnedFriend',node=>node.textContent),'VIEW MY FRIENDS');
  await page.click('#showSpiral');
  assert.equal(await contracts.allowlist.allowlistClaimed(buyer),2n);assert.equal(await contracts.allowlist.publicMinted(),0n);
  pass('Main and Wishlist mint entries stay available, explain an exhausted allowlist and block a third transaction');

  await selectScenario('spiral');assert.equal(await page.$('#summaryRaised'),null);assert.match(await page.$eval('#summaryCurrent',el=>el.textContent),/ETH/);
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='done',{timeout:15_000});
  assert.equal(await page.$$eval('#nodes .node canvas',els=>els.length),14);
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),0);
  await page.click('#showCollectionMode');
  await page.waitForFunction(()=>!document.querySelector('#forest-view').hidden&&document.querySelectorAll('#gallery .forest-card').length===13);
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),13);
  assert.match(await page.$eval('#collection-caption',node=>node.textContent),/from myFriends Local\.$/);
  await page.click('#showSpiralMode');
  await page.waitForFunction(()=>document.querySelector('#forest-view').hidden&&!document.querySelector('#universe').hidden);
  await page.click('#nodes [data-slot="1"]');assert.match(await page.$eval('#contextPanel h2',el=>el.textContent),/^Mycelium Friend #/);
  const gen=editions[0].genotype;
  assert.equal(await page.$eval('#preview',el=>el.dataset.genotype),gen.join(','));
  const uri=await contracts.spiral.tokenURI(await contracts.spiral.tokenForTraits(...gen),{gasLimit:50_000_000});
  const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),renderSVG(gen));
  await page.click('#backBuild');
  const before=await page.$eval('#preview',el=>el.dataset.genotype);await page.click('#next-cap');assert.notEqual(await page.$eval('#preview',el=>el.dataset.genotype),before);
  pass('Real 3 allowlist + 10 public spiral, on-chain tokenURI artwork parity, live trait controls');
  await page.reload();await synced();
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),0);
  await page.click('#showCollectionMode');
  await page.waitForFunction(()=>!document.querySelector('#forest-view').hidden&&document.querySelectorAll('#gallery .forest-card').length===13);
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),13);
  offline=true;await page.click('#retryChain');await page.waitForFunction(()=>document.querySelector('#chainStatus').dataset.tone==='error',{timeout:30_000});
  assert.equal(await page.$$eval('#gallery .forest-card',els=>els.length),13);
  assert.equal(await page.$eval('#mint',el=>el.disabled),true);
  await page.click('#next-cap');offline=false;await page.click('#retryChain');await synced();
  pass('Cache survives reload and RPC outage; builder stays responsive; mint resumes only after sync');
  stage('mobile layout, wallet changes and local faucet');
  await Promise.all([mkdir('output/previews/site-ui/desktop',{recursive:true}),mkdir('output/previews/site-ui/mobile',{recursive:true})]);
  await page.screenshot({path:'output/previews/site-ui/desktop/myfriends-connected.png'});
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.reload();await synced();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.$eval('#deploymentSelect',el=>el.hidden&&getComputedStyle(el).display==='none'),true);
  const overlapping=await page.evaluate(()=>{const a=document.querySelector('.mint-summary').getBoundingClientRect(),b=document.querySelector('.view-tools').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});
  assert.equal(overlapping,false,'Mobile stats and zoom controls overlap');
  await page.screenshot({path:'output/previews/site-ui/mobile/myfriends-connected.png',fullPage:true});
  assert.deepEqual(errors,[]);
  pass('Mobile 390px layout, production navigation without a deployment selector, no horizontal overflow or browser exceptions');
  // The same receipt flow on mobile, including reduced-motion celebration.
  await selectScenario('public');await selectGenotype([8,3,2,1,0,0]);expectedDialog=null;
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await review();
  const sentBeforeAccountChange=transactions;
  await page.evaluate(()=>window.testEmit('accountsChanged',['0x3333333333333333333333333333333333333333']));
  await page.waitForFunction(()=>document.querySelector('#mintBody').textContent.includes('wallet or network changed'));
  assert.equal(await page.$$eval('#mintBody button',nodes=>nodes.some(n=>n.textContent==='MINT MYFRIEND')),false);
  assert.equal(transactions,sentBeforeAccountChange);await checkDialog();await page.click('#closeMint');
  await page.evaluate(buyer=>window.testEmit('accountsChanged',[buyer]),buyer);
  expectedDialog=null;await review();await confirm();
  await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your myFriend is here!');
  assert.equal(await page.$$eval('#mintCelebration i',nodes=>nodes.length),0);
  assert.equal(await page.$eval('#mintDialog',node=>node.scrollWidth>node.clientWidth),false);
  await success();
  pass('Mobile mint success preserves dialog and preview; wallet changes block stale confirmation; reduced-motion preference suppresses confetti.');
  // Local faucet is restricted to the exact browser origin and official local deployments.
  const faucet=await page.evaluate(async deploymentId=>{
    const response=await fetch('/api/local/fund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:'0x3333333333333333333333333333333333333333',deploymentId})});
    return {status:response.status,body:await response.json()};
  },config.deployments.find(d=>d.scenario==='allowlist-free').id);
  assert.equal(faucet.status,200);assert.equal(faucet.body.ok,true);
  assert.equal(await provider.getBalance('0x3333333333333333333333333333333333333333'),10n**19n);
  const blocked=await fetch(home+'api/local/fund',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(blocked.status,403);
  pass('Local test-ETH faucet and allowlist access work; cross-origin requests are rejected');
  await mkdir('output/reports',{recursive:true});await writeFile('output/reports/web3.json',JSON.stringify({checks,transactions,fixtureDeployments:fixtureConfig.deployments.map(d=>d.address)},null,2)+'\n');
  console.log(`DONE: browser E2E · ${checks.length} checks · ${Math.round((Date.now()-browserStarted)/1000)}s`);
}catch(error){
  failure=error;
  if(page){
    try{console.log('Failure context',await page.evaluate(()=>({status:document.querySelector('#chainStatus')?.textContent,modal:document.querySelector('#mintBody')?.textContent,ready:document.body?.dataset.ready})),errors);}
    catch(contextError){console.error('Could not collect browser failure context:',contextError);}
    try{await page.screenshot({path:path.join(os.tmpdir(),'myfriends-test-failure.png')});}
    catch(screenshotError){console.error('Could not capture browser failure screenshot:',screenshotError);}
  }
}
finally{
  clearInterval(browserHeartbeat);
  const cleanupErrors=[];
  if(browser)try{await browser.close();}catch(error){cleanupErrors.push(error);}
  for(const stream of browserProcess?.stdio||[])try{stream?.destroy();}catch(error){cleanupErrors.push(error);}
  try{provider?.destroy();}catch(error){cleanupErrors.push(error);}
  if(temp)try{await rm(temp,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
  if(cleanupErrors.length){
    if(failure)console.error('Browser E2E cleanup also failed:',cleanupErrors);
    else throw new AggregateError(cleanupErrors,'Browser E2E cleanup failed');
  }
}
if(failure)throw failure;
