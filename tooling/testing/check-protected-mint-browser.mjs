import assert from 'node:assert/strict';
import {createInterface} from 'node:readline/promises';
import ganache from 'ganache';
import puppeteer from 'puppeteer-core';
import {build} from 'esbuild';
import {BrowserProvider,ContractFactory,keccak256} from 'ethers';
import {compileContracts} from '../lib/compile-contracts.mjs';
import {TRAIT_COUNTS,MAX_SUPPLY} from '../../collection/source/token-id.js';
import {checkPublicMintUI} from '../lib/check-public-mint-ui.mjs';
console.log('RUN: compile protected-mint browser fixtures');
const compileStarted=Date.now();
const {compiled}=compileContracts();
console.log(`DONE: compile protected-mint browser fixtures · ${Math.round((Date.now()-compileStarted)/1000)}s`);
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337}});
const manualA11y=process.env.MANUAL_A11Y==='1';
const manualVisual=process.env.MANUAL_VISUAL==='1';
const manual=manualA11y||manualVisual;
const prompts=manual?createInterface({input:process.stdin,output:process.stdout}):null;
let browser,provider,progressTimer,progressStage='deploy contracts and launch browser';
const progressStarted=Date.now();
const stage=label=>{progressStage=label;console.log(`RUN: protected-mint browser · ${label}`);};
const manualReview=manual?async label=>{
  process.stdout.write('\x07');
  const instruction=manualA11y?'with VoiceOver ':'visually ';
  await prompts.question(`MANUAL: inspect the ${label} dialog ${instruction}and press Enter here to continue. `);
}:undefined;
try{
  stage(progressStage);
  progressTimer=setInterval(()=>console.log(`WORKING: protected-mint browser · ${progressStage} · ${Math.round((Date.now()-progressStarted)/1000)}s elapsed`),20_000);
  progressTimer.unref();
  provider=new BrowserProvider(local,undefined,{cacheTimeout:-1});provider.pollingInterval=10;const signer=await provider.getSigner(),buyer=await signer.getAddress();
  const deploy=async(file,name,args)=>{const a=compiled.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
  const descriptor=await deploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[TRAIT_COUNTS,MAX_SUPPLY]);
  const renderer=await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[descriptor.target]);
  const nft=await deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[descriptor.target,renderer.target,buyer,buyer,100,buyer]);
  const receipt=await nft.deploymentTransaction().wait(),block=await provider.getBlock(receipt.blockNumber);
  await(await nft.startAllowlistSale()).wait();
  await(await nft.openPublicSale()).wait();
  const deployment={mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,address:nft.target,deploymentBlock:receipt.blockNumber,deploymentHash:block.hash,codeHash:keccak256(await provider.getCode(nft.target))};
  const bundle=await build({stdin:{contents:`import {BrowserProvider} from 'ethers';import {openProtectedMint} from './apps/web/src/protected-mint-panel.js';
    import * as protection from './apps/web/src/mint-protection.js';import {ProtectedMintFlow} from './apps/web/src/protected-mint-flow.js';
    window.harness={openProtectedMint,protection,ProtectedMintFlow,BrowserProvider};`,resolveDir:process.cwd()},bundle:true,format:'iife',write:false,platform:'browser'});
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:!manual,args:['--no-sandbox']});
  const page=await browser.newPage(),rpc=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('mintRPC',async request=>{rpc.push(request);return local.request(request);});
  await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Protected mint test</title><main id="host"></main>'}));
  const load=async()=>{await page.goto('https://mint.test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(({deployment,buyer,counts})=>{
    const p=new harness.BrowserProvider({request:r=>window.mintRPC(r)},undefined,{cacheTimeout:-1});p.pollingInterval=10;
    window.options={host:document.querySelector('#host'),deployment,provider:p,buyer,selections:[[0,0,0,0,0,0]],counts,getSigner:()=>p.getSigner(),onComplete:()=>{window.completed=true;}};
  },{deployment,buyer,counts:TRAIT_COUNTS});};
  const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes(t)&&!b.disabled),{},text);await page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(t)).click(),text);};
  const contains=async text=>page.waitForFunction(t=>document.body.textContent.includes(t),{},text);
  stage('durable intent, commitment countdown and reload recovery');
  await load();await page.evaluate(()=>harness.openProtectedMint(options));
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('myfriends:mint-intent:v1:')))));
  assert.ok(saved.salt);assert.equal(saved.state,'saved');
  assert.equal(await page.$$eval('details[open]',nodes=>nodes.length),0,'Technical options must be collapsed by default');
  await click('PREPARE MY MINT');await contains('SECONDS');
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,1);
  const forbidden=['isAvailable','genotypeForTraits','makeCommitment','revealMint'].map(n=>nft.interface.getFunction(n).selector);
  for(const r of rpc)if(['eth_call','eth_estimateGas'].includes(r.method))assert.ok(!forbidden.some(s=>r.params[0].data?.startsWith(s)),'Pre-maturity targeted RPC');
  for(const r of rpc)assert.ok(!JSON.stringify(r).includes(saved.salt.slice(2)),'Salt leaked before maturity');
  await load();await page.evaluate(()=>harness.openProtectedMint(options));await contains('SECONDS');
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,1,'Reload sent a duplicate');
  await local.request({method:'evm_increaseTime',params:[60]});await local.request({method:'evm_mine',params:[]});
  await contains('CURRENT PRICE'); // advances automatically after maturity, without a status-check click
  assert.equal(await page.$eval('input[type=range]',e=>e.value),'0');
  await page.$eval('input[type=range]',async e=>{e.value='3';await e.onchange();});await contains('0.0003 ETH');
  assert.equal(await page.$eval('input[type=range]',e=>e.step),'1');
  await click('MINT MYFRIEND');await page.waitForFunction(()=>window.completed===true,{timeout:20000});
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,2,'Public purchase needs exactly commit+reveal transactions');
  assert.equal(await nft.totalMinted(),1n);assert.equal(await provider.getBalance(nft.target),0n,'First mint refund retained buffer');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('myfriends:mint-intent:v1:')))).exposed),true);
  assert.deepEqual(errors,[]);
  await load();await page.evaluate(()=>harness.openProtectedMint(options));
  assert.equal(await page.evaluate(()=>window.completed),true,'Reload of minted selection must complete, never offer a second commit');
  assert.equal(await page.$$eval('button',nodes=>nodes.filter(b=>/PREPARE MY MINT|MINT MYFRIEND/.test(b.textContent)).length),0);
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,2,'Reopening success must be read-only');
  console.log('PASS: real browser + production EVM: durable pre-prompt storage, no pre-maturity preimage RPC, reload recovery, Exact default/slider, two transaction confirmations, atomic refund.');
  // Storage failure must stop before any wallet request.
  stage('fail-closed storage and concurrent submission');
  const before=rpc.filter(r=>r.method==='eth_sendTransaction').length;
  assert.equal(await page.evaluate(async()=>{try{await harness.openProtectedMint({...options,selections:[[1,0,0,0,0,0]],storage:{length:0,setItem(){},getItem(){return null;}}});return false;}catch{return true;}}),true);
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,before);
  console.log('PASS: disabled/silent local storage fails closed before commitment submission.');
  const newFlow=async selections=>page.evaluate(selections=>{
    const {deployment,buyer,counts,provider,getSigner}=options;
    const domain={chainId:deployment.chainId,collection:deployment.address,buyer,deploymentHash:deployment.deploymentHash,codeHash:deployment.codeHash};
    const store=new harness.protection.IntentStore(localStorage,domain,counts),record=store.save(harness.protection.createIntent(domain,selections,counts));
    window.flow=new harness.ProtectedMintFlow({deployment,provider,store,record,getSigner});return record;
  },selections);
  const second=await newFlow([[1,0,0,0,0,0]]);
  const results=await page.evaluate(async()=>Promise.allSettled([flow.sendCommit(),flow.sendCommit()]).then(a=>a.map(r=>r.status)));
  assert.deepEqual(results,['fulfilled','rejected']);
  assert.equal((await page.evaluate(()=>flow.sync().then(s=>({state:s.state,phase:s.phase})))).state,'waiting');
  assert.equal(await page.evaluate(async()=>{try{await flow.review(0);return false;}catch{return true;}}),true);
  await local.request({method:'evm_increaseTime',params:[60]});await local.request({method:'evm_mine',params:[]});
  await page.evaluate(async()=>{window.quote=await flow.review(3);});
  const other=await provider.getSigner(1),otherAddress=await other.getAddress(),salt='0x'+'44'.repeat(32),chosen=[[1,0,0,0,0,0]];
  const hash=await nft.makeCommitment(otherAddress,chosen,salt);await(await nft.connect(other).commit(hash)).wait();
  await local.request({method:'evm_increaseTime',params:[60]});await local.request({method:'evm_mine',params:[]});
  const price=await nft.mintPrice(1);await(await nft.connect(other).revealMint(chosen,salt,price,9999999999,{value:price})).wait();
  const attempts=rpc.filter(r=>r.method==='eth_sendTransaction').length;
  assert.equal(await page.evaluate(async()=>{try{await flow.sendReveal(quote);return false;}catch{return flow.record.exposed;}}),true);
  assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,attempts,'Failed simulation opened a wallet prompt');
  assert.notEqual(await nft.commitments(buyer,second.hash),0n);
  const replay=await page.evaluate(()=>({record:flow.store.read(flow.record.hash),reviews:flow.record.reviews}));assert.equal(replay.record.exposed,true);assert.equal(replay.reviews.at(-1).buffer,3);
  console.log('PASS: concurrent submit lock, immature simulation rejection, failed reveal simulation marks EXPOSED durably without retry, cap review history persists.');
  stage('pending transaction reconstruction');
  await newFlow([[2,0,0,0,0,0]]);await local.request({method:'miner_stop',params:[]});
  try {
    await page.evaluate(()=>flow.sendCommit().then(tx=>tx.hash));
    const pending=await page.evaluate(()=>flow.sync().then(s=>({state:s.state,phase:s.phase})));assert.equal(pending.state,'pending');
    await page.evaluate(()=>{flow=new harness.ProtectedMintFlow({deployment:options.deployment,provider:options.provider,store:flow.store,record:flow.store.read(flow.record.hash),getSigner:options.getSigner});});
    assert.equal((await page.evaluate(()=>flow.sync().then(s=>({state:s.state,phase:s.phase})))).state,'pending');
    const sent=rpc.filter(r=>r.method==='eth_sendTransaction').length;
    assert.equal(await page.evaluate(async()=>{try{await flow.sendCommit();return false;}catch{return true;}}),true);
    assert.equal(rpc.filter(r=>r.method==='eth_sendTransaction').length,sent);
  } finally {await local.request({method:'miner_start',params:[1]});}
  assert.equal((await page.evaluate(()=>flow.sync().then(s=>({state:s.state,phase:s.phase})))).state,'waiting');
  console.log('PASS: real pending commit survives controller reconstruction and blocks duplicate submission; canonical receipt resumes countdown.');
  stage('actual website public-mint experience and responsive success');
  await checkPublicMintUI({browser,local,deployment,buyer,nft,manualReview});

}finally{
  clearInterval(progressTimer);
  try{
    if(browser){
      const child=browser.process();
      await browser.close();
      // Chrome descendants can retain a log pipe after the browser exits on macOS.
      // Release only this runner's pipes after confirmed exit, never force success.
      assert.ok(!child||child.exitCode!==null||child.signalCode!==null,'Browser process did not exit');
      for(const stream of child?.stdio||[])stream?.destroy();
    }
  }
  finally{prompts?.close();provider?.destroy();await local.disconnect();}
}
