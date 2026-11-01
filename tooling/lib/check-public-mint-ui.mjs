// Run from check-protected-mint-browser.mjs against its isolated production EVM.
// This loads the actual built website, including its real receipt/celebration UI.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {siteSourcePath} from './site-paths.mjs';
import {catalogFingerprint} from './deployment-plan.mjs';

const require=createRequire(import.meta.url),axeSource=await readFile(require.resolve('axe-core/axe.min.js'),'utf8');

export async function checkPublicMintUI({browser,local,deployment,buyer,nft,manualReview=async()=>{}}){
  const page=await browser.newPage(),errors=[],sent=[],mintEvidence=[];let delayPreflight=false;
  const previewRoot='output/previews/mint-flow';
  const previewSteps={
    preparing:'01-preparing',start:'02-review',wallet:'03-wallet-menu','commit-rejected':'04-commit-rejected',
    'commit-unknown':'05-commit-unknown','commit-pending':'06-commit-pending',countdown:'07-countdown',ready:'08-ready',
    paused:'09-sale-paused','wallet-changed':'10-wallet-changed','reveal-rejected':'11-mint-rejected',
    'reveal-pending':'12-mint-pending',success:'13-success'
  };
  const previewViewports=[
    {directory:'desktop',width:1440,height:1000},
    {directory:'mobile-390',width:390,height:844},
    {directory:'mobile-320',width:320,height:568}
  ];
  const protectedArtHeights=new Map();
  const origin='https://public-mint.test';
  const config={version:1,activeDeployment:'ux-public',deployments:[{...deployment,id:'ux-public',label:'Local public UX',networkName:'Local Ethereum',rpcUrl:origin+'/rpc',mintEvidenceUrl:origin+'/mint-events',explorerUrl:'https://explorer.test',catalogHash:catalogFingerprint().sha256}]};
  const rpc=async r=>{
    if(delayPreflight&&r.method==='eth_getCode'){delayPreflight=false;await new Promise(resolve=>setTimeout(resolve,2000));}
    try{return {id:r.id,jsonrpc:'2.0',result:await local.request(r)}}
    catch(error){return {id:r.id,jsonrpc:'2.0',error:{code:error.code||-32000,message:error.message,data:error.data}}}
  };
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('walletRPC',async r=>{if(r.method==='eth_sendTransaction')sent.push(r);return local.request(r)});
  await page.evaluateOnNewDocument(buyer=>{
    const listeners={};
    window.testWalletEvent=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
    window.ethereum={on:(event,fn)=>(listeners[event]||=[]).push(fn),removeListener:(event,fn)=>{listeners[event]=(listeners[event]||[]).filter(f=>f!==fn)},
      request:async({method,params=[]})=>{
        if(method==='eth_sendTransaction'&&window.rejectNext){window.rejectNext=false;throw Object.assign(Error('User rejected'),{code:4001})}
        if(method==='eth_sendTransaction'&&window.unknownNext){window.unknownNext=false;throw Object.assign(Error('Wallet did not respond'),{code:-32603})}
        if(method==='eth_getTransactionCount'&&window.pauseNonce){window.noncePaused=true;await new Promise(resolve=>window.releaseNonce=resolve);window.pauseNonce=false}
        return ['eth_accounts','eth_requestAccounts'].includes(method)?[buyer]:window.walletRPC({method,params});
      }};
  },buyer);
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    try{
      const url=new URL(request.url());
      if(url.origin!==origin)return request.respond({status:200,contentType:'application/json',body:'{}'});
      if(url.pathname==='/chain-config.json')return request.respond({status:200,contentType:'application/json',body:JSON.stringify(config)});
      if(url.pathname==='/mint-events'){
        mintEvidence.push(JSON.parse(request.postData()));
        return request.respond({status:204,headers:{'access-control-allow-origin':origin}});
      }
      if(url.pathname==='/rpc'){
        const input=JSON.parse(request.postData());
        return request.respond({status:200,contentType:'application/json',body:JSON.stringify(Array.isArray(input)?await Promise.all(input.map(rpc)):await rpc(input))});
      }
      const file=path.resolve(process.cwd(),siteSourcePath(url.pathname));
      if(!file.startsWith(process.cwd()+path.sep))throw Error('Outside site');
      const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
      return request.respond({status:200,contentType:type,body:await readFile(file)});
    }catch{return request.respond({status:404,body:''})}
  });
  const screen=state=>page.waitForFunction(state=>document.querySelector('#mintBody')?.dataset.mintScreen===state,{},state);
  const click=label=>page.evaluate(label=>[...document.querySelectorAll('#mintBody button')].find(b=>b.textContent===label).click(),label);
  const clickAction=async action=>{
    await page.waitForFunction(action=>{const b=document.querySelector(`[data-mint-action="${action}"]`);return b&&!b.disabled&&!b.hidden},{},action);
    await page.click(`[data-mint-action="${action}"]`);
  };
  const clickMint=async()=>{
    const selector=await page.waitForFunction(()=>{
      for(const selector of ['#previewMint','#mint']){
        const button=document.querySelector(selector);
        if(button&&!button.disabled&&!button.hidden&&getComputedStyle(button).display!=='none')return selector;
      }
      return false;
    }).then(handle=>handle.jsonValue());
    await page.click(selector);
  };
  const journey=()=>page.$$eval('.mint-journey-step',els=>els.map(e=>e.dataset.state));
  const resume=async state=>{
    await page.waitForFunction(()=>document.querySelector('#chainStatus')?.dataset.ready==='true'&&document.querySelector('#wallet')?.dataset.state==='connected');
    assert.equal(await page.$('#viewMint'),null,'Mint recovery belongs in Wallet Menu, not a separate header link');
    await page.click('#wallet');
    await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet'&&document.querySelector('.wallet-mint-mini'));
    await page.click('.wallet-mint-mini');await screen(state);
    assert.equal(await page.$eval('#mintPreview',e=>e.dataset.genotype),'5,0,6,0,0,0','Resume must restore the mint selection, not the current builder');
  };
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>{
    const d=document.querySelector('#mintDialog'),r=d.getBoundingClientRect();
    return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth&&document.querySelector('.mint-scroll').scrollWidth<=document.querySelector('.mint-scroll').clientWidth;
  }),true,'Mint dialog overflows the viewport');
  const capturePreview=async(label,{review=true}={})=>{
    const original=page.viewport(),filename=previewSteps[label]||label;
    for(const {directory,width,height} of previewViewports){
      await page.setViewport({width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await noOverflow();
      if(width<=600&&await page.$eval('#mintDialog',node=>node.classList.contains('is-protected'))){
        const heightNow=Math.round(await page.$eval('.mint-art',node=>node.getBoundingClientRect().height));
        assert.ok(heightNow>=119,`Protected mint artwork is too small at ${width}px: ${heightNow}px`);
        if(protectedArtHeights.has(width))assert.equal(heightNow,protectedArtHeights.get(width),`Protected mint artwork height changed at ${width}px`);
        else protectedArtHeights.set(width,heightNow);
      }
      await mkdir(`${previewRoot}/${directory}/public`,{recursive:true});
      await page.screenshot({path:`${previewRoot}/${directory}/public/${filename}.png`});
      if(review&&directory==='mobile-390')await manualReview(`public ${filename} at ${width}px`);
    }
    await page.setViewport(original);
  };
  const accessible=async label=>{
    if(!await page.evaluate(()=>Boolean(window.axe)))await page.addScriptTag({content:axeSource});
    const violations=await page.evaluate(async()=>{
      const result=await window.axe.run(document.querySelector('#mintDialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return result.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>node.target.join(' '))}));
    });
    assert.deepEqual(violations,[],`${label} mint dialog axe violations: ${JSON.stringify(violations)}`);
  };
  try{
    await mkdir(previewRoot,{recursive:true});
    await writeFile(`${previewRoot}/README.txt`,`MYCELIUM FRIENDS — MINT FLOW PREVIEWS\n\nOpen one device folder:\n- desktop — 1440 × 1000\n- mobile-390 — current iPhone-sized viewport, 390 × 844\n- mobile-320 — compact stress test, 320 × 568\n\nInside each device folder:\n- public — protected public mint, numbered in journey order\n- allowlist — free allowlist mint and eligibility outcomes\n\nThe number at the start of every filename is the order in which a person sees the screen.\nAll images are generated from the real current frontend against disposable local contracts.\nNo mainnet transaction is sent.\n`);
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin+'/#genotype=5,0,6,0,0,0');
    await page.waitForFunction(()=>document.querySelector('#chainStatus')?.dataset.ready==='true'&&document.querySelector('#wallet')?.dataset.state==='connected');
    delayPreflight=true;await clickMint();await screen('preparing');
    assert.equal(await page.$eval('#mintTitle',e=>e.textContent),'Let’s bring your friend home');
    assert.equal(await page.$eval('#mintDialog',e=>e.classList.contains('is-protected')),true,'Preflight must use the final protected dialog shell');
    assert.deepEqual(await journey(),['current','next','next']);
    assert.match(await page.$eval('.protected-preflight-status',e=>e.textContent),/Loading|Checking|Connecting|Almost ready/);
    await capturePreview('preparing',{review:false});
    await screen('start');
    assert.equal(await page.$eval('#mintTitle',e=>e.textContent),'Let’s bring your friend home');
    assert.equal(await page.$('.protected-purchase-state'),null,'Do not show the confusing purchase-status quote');
    assert.deepEqual(await journey(),['current','next','next']);
    assert.equal(await page.$eval('#mintProgress',e=>getComputedStyle(e).display),'none','Metro replaces the old progress bar');
    assert.equal(await page.$$eval('.mint-journey-step',els=>els.every(e=>getComputedStyle(e,'::before').borderRadius==='50%')),true,'Every step has a station marker');
    assert.deepEqual(await page.$$eval('.mint-journey-step',els=>els.map(e=>e.textContent)),['Prepare','Wait','Mint']);
    assert.equal(await page.$$eval('#mintBody details[open]',n=>n.length),0);
    assert.equal(await page.$eval('#mintDetails',e=>getComputedStyle(e).display),'none');
    assert.equal(await page.$('.protected-forget'),null,'A fresh mint review has nothing to abandon');
    await noOverflow();
    await accessible('Start');
    await capturePreview('start');
    await page.click('#closeMint');await page.click('#wallet');
    await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet');
    await accessible('Wallet');
    await capturePreview('wallet');
    assert.equal(await page.$$eval('.wallet-mint-mini',n=>n.length),0,'A local review with no transaction must stay in History and out of Wallet Menu');
    await page.click('#closeMint');await page.click('#mint');await screen('start');
    await page.evaluate(()=>window.rejectNext=true);await clickAction('commit');
    await page.waitForFunction(()=>document.querySelector('.protected-notice')?.textContent.includes('cancelled'));
    await screen('start');assert.equal(sent.length,0,'Rejected preparation must send nothing');
    assert.equal(await page.$eval('[data-mint-action=commit]',e=>e.textContent),'TRY WALLET AGAIN');
    await capturePreview('commit-rejected');
    await page.evaluate(()=>window.unknownNext=true);await clickAction('commit');await screen('unknown-commit');
    assert.equal(await page.$('[data-mint-action=commit]'),null,'An uncertain wallet response must not offer another submission');
    assert.equal(await page.$$eval('#mintBody > details',els=>els.length),1,'Only one collapsed help section should accompany the main action');
    await capturePreview('commit-unknown');
    await clickAction('check');
    await page.waitForFunction(()=>!document.querySelector('[data-mint-action=check]').disabled);
    assert.equal(sent.length,0,'Checking an uncertain wallet response must not send anything');
    await page.click('#closeMint');await page.reload();await resume('unknown-commit');
    await page.evaluate(()=>document.querySelectorAll('#mintBody details').forEach(e=>e.open=true));
    await page.click('.protected-unsent input');await click('Return to review');await screen('start');
    assert.equal(sent.length,0,'Explicit recovery of a verified unsent request is read-only');
    await page.evaluate(()=>window.pauseNonce=true);await clickAction('commit');
    await page.waitForFunction(()=>window.noncePaused);
    await page.click('#closeMint');await page.evaluate(()=>window.releaseNonce());
    await page.waitForFunction(()=>!document.querySelector('#mint').disabled);
    await page.click('#mint');await screen('start');
    assert.equal(sent.length,0,'Closing at the final nonce boundary must not send or leave the UI busy');
    await local.request({method:'miner_stop',params:[]});
    try{
      await clickAction('commit');await screen('pending-commit');
      assert.deepEqual(await journey(),['current','next','next']);
      await capturePreview('commit-pending');
      await clickAction('check');
      await page.waitForFunction(()=>!document.querySelector('[data-mint-action=check]').disabled);
      await page.click('#closeMint');
      await page.goto(origin+'/#history?genotype=1,2,3,4,0,1');
      await resume('pending-commit');await clickAction('check');
      await page.waitForFunction(()=>!document.querySelector('[data-mint-action=check]').disabled);
      assert.equal(sent.length,1,'Checking or reloading a pending preparation must not resend it');
    }finally{await local.request({method:'miner_start',params:[1]});}
    await screen('waiting');
    assert.deepEqual(await journey(),['done','current','next']);
    assert.equal(sent.length,1);
    assert.equal(await page.$eval('[data-mint-action=check]',e=>getComputedStyle(e).display),'none');
    await capturePreview('countdown');
    // A browser clock reaching zero is not permission to mint before chain maturity.
    await page.evaluate(()=>{window.realNow=Date.now;Date.now=()=>window.realNow()+61000});
    await clickAction('check');
    await page.waitForFunction(()=>!document.querySelector('[data-mint-action=check]').disabled);
    await screen('waiting');assert.equal(sent.length,1);
    await page.evaluate(()=>{Date.now=window.realNow});
    await local.request({method:'evm_increaseTime',params:[60]});await local.request({method:'evm_mine',params:[]});
    await screen('ready');
    assert.equal(await page.$eval('#mintTitle',e=>e.textContent),'Ready to bring your myFriend home?');
    assert.equal(await page.$('.protected-forget'),null,'The final mint review must not offer the old large cancel action');
    assert.deepEqual(await journey(),['done','done','current']);
    assert.equal(await page.$eval('.mint-journey-step[aria-current=step]',e=>e.textContent),'Mint');
    assert.equal(await page.$eval('.protected-buffer-choice output',e=>e.textContent),'NO BUFFER','Keep an explicit opt-in, never silently increase the payment');
    assert.equal(await page.$eval('.protected-buffer-choice span',e=>e.textContent),'0 earlier mints');
    assert.match(await page.$eval('.protected-buffer-refund',e=>e.textContent),/only pay the final mint price.*unused buffer is refunded automatically.*network fee is separate/i);
    await page.$eval('#mintBody > .protected-options',details=>{details.open=true});
    assert.equal(await page.$$eval('.protected-explorer-links a',links=>links.length),2,'Transaction and contract links must both be present');
    await accessible('Ready');
    await capturePreview('ready');
    assert.equal(await page.$eval('.protected-explorer-links',links=>{
      const [transaction,contract]=links.querySelectorAll('a'),a=transaction.getBoundingClientRect(),b=contract.getBoundingClientRect();
      return b.top>=a.bottom;
    }),true,'Transaction and contract links must have separate rows');
    await page.click('#closeMint');await page.reload();await resume('ready');
    assert.equal(sent.length,1,'Resuming the final review must not restart preparation');
    await(await nft.pausePublicSale()).wait();
    await page.click('#closeMint');await resume('paused');
    assert.equal(sent.length,1,'A paused sale must allow read-only access to saved progress');
    await capturePreview('paused');
    await(await nft.resumePublicSale()).wait();await click('CHECK AGAIN');await screen('ready');
    await page.evaluate(()=>window.testWalletEvent('accountsChanged',['0x3333333333333333333333333333333333333333']));
    await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Let’s check your wallet');
    assert.equal(await page.$('.protected-primary'),null,'Wallet change must remove the stale mint action');
    assert.equal(sent.length,1);
    await capturePreview('wallet-changed');
    await page.evaluate(buyer=>window.testWalletEvent('accountsChanged',[buyer]),buyer);
    await click('REVIEW WITH THIS WALLET');await screen('ready');
    assert.equal(await page.$eval('#mintPreview',e=>e.dataset.genotype),'5,0,6,0,0,0','Wallet change review must retain the resumed mint selection');
    await page.evaluate(()=>window.rejectNext=true);await clickAction('reveal');
    await page.waitForFunction(()=>document.querySelector('.protected-notice')?.textContent.includes('cancelled'));
    await screen('ready');assert.equal(sent.length,1,'Rejected reveal must not add a transaction');
    assert.equal(await page.$eval('[data-mint-action=reveal]',e=>e.textContent),'TRY WALLET AGAIN');
    await capturePreview('reveal-rejected');
    await page.$eval('.protected-range',e=>{e.value='3';e.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.$eval('.protected-buffer-choice output',e=>e.textContent),'+0.0003 ETH BUFFER');
    assert.equal(await page.$eval('.protected-buffer-choice span',e=>e.textContent),'3 earlier mints');
    assert.match(await page.$eval('.protected-price-card',e=>e.textContent),/High demand can move the price/);
    for(const width of [1440,390,320]){
      await page.setViewport({width,height:width===1440?1000:844});await noOverflow();
      const ratio=await page.$eval('.protected-range',e=>e.getBoundingClientRect().width/e.parentElement.getBoundingClientRect().width);
      assert.ok(ratio>.8,'Price control must span its card');
      if(width>=390){
        const refundGeometry=await page.evaluate(()=>{const refund=document.querySelector('.protected-buffer-refund').getBoundingClientRect(),action=document.querySelector('.protected-primary').getBoundingClientRect(),scroll=document.querySelector('.mint-scroll');return {refundBottom:refund.bottom,actionTop:action.top,gap:action.top-refund.bottom,scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight};});
        assert.ok(refundGeometry.gap>=0,`The automatic refund must be fully visible, not buried below the action: ${JSON.stringify(refundGeometry)}`);
      }
      assert.equal(await page.$eval('.protected-primary',el=>{const box=el.getBoundingClientRect();return document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)===el}),true,'Mint action must be visible without scrolling');
    }
    await page.setViewport({width:390,height:844});
    await local.request({method:'miner_stop',params:[]});
    try{
      await clickAction('reveal');await screen('pending-reveal');
      assert.deepEqual(await journey(),['done','done','current']);
      await capturePreview('reveal-pending');
      await clickAction('check');
      await page.waitForFunction(()=>!document.querySelector('[data-mint-action=check]').disabled);
      await page.click('#closeMint');await page.reload();await resume('pending-reveal');
      assert.equal(sent.length,2,'Checking or reloading a pending purchase must never send another transaction');
    }finally{await local.request({method:'miner_start',params:[1]});}
    await page.waitForFunction(()=>document.querySelector('#mintDialog')?.classList.contains('is-success'),{timeout:20000});
    assert.equal(sent.length,2,'Main website must request only commit + reveal');
    assert.equal(await page.$eval('#mintTitle',e=>e.textContent),'Your myFriend is here!');
    assert.deepEqual(await journey(),['done','done','done'],'Success must finish the same metro journey');
    assert.equal(await page.$$eval('.mint-downloads button',n=>n.length),3);
    assert.equal(await page.$$eval('#shareMint,#shareMintImage,#copyMintLink',n=>n.length),3);
    assert.equal(await page.$eval('#shareMint',node=>{const url=new URL(node.href),text=url.searchParams.get('text')||'';return !url.searchParams.has('url')&&/^Meet myFriend #\d+ 🍄\nhttps:\/\/api\.mycelium\.magicforest\.land\/share\/myfriend\/\d+$/.test(text);}),true,'X composer must contain the token-specific share page in its prepared text');
    assert.equal(await page.$$eval('#mintCelebration i',n=>n.length),48);
    assert.equal(await page.evaluate(()=>myFriendsUI.owned().some(r=>r.genotype.join(',')==='5,0,6,0,0,0')),true);
    for(let i=0;i<100&&!mintEvidence.some(event=>event.stage==='confirmed');i++)await new Promise(resolve=>setTimeout(resolve,20));
    const confirmedEvidence=mintEvidence.find(event=>event.stage==='confirmed');
    assert.ok(confirmedEvidence,'Protected public mint did not report confirmed evidence');
    const confirmedJourney=mintEvidence.filter(event=>event.evidenceId===confirmedEvidence.evidenceId);
    assert.deepEqual(confirmedJourney.slice(-3).map(event=>event.stage),['intent','submitted','confirmed']);
    assert.equal(confirmedEvidence.wallet.toLowerCase(),buyer.toLowerCase());
    assert.equal(confirmedJourney.some(event=>'country' in event||'ip' in event),false,'Browser invented location evidence');
    await accessible('Success');
    await capturePreview('success');
    await noOverflow();
    await click('VIEW MY FRIENDS');
    await page.waitForFunction(()=>!document.querySelector('#myfriends-view').hidden);
    assert.ok(await page.$$eval('#myfriends-gallery .forest-card',n=>n.length)>0);
    // Simulate the stale local state seen after an interrupted receipt update.
    // Canonical history must still keep an already minted genotype out of progress.
    await page.evaluate(()=>{
      const key=Object.keys(localStorage).find(k=>{if(!k.startsWith('myfriends:mint-intent:v1:'))return false;try{return JSON.parse(localStorage.getItem(k)).selections[0].join(',')==='5,0,6,0,0,0';}catch{return false;}});
      if(!key)throw Error('Expected completed recovery record');
      const record=JSON.parse(localStorage.getItem(key));record.state='ready';localStorage.setItem(key,JSON.stringify(record));
    });
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#chainStatus')?.dataset.ready==='true'&&document.querySelector('#wallet')?.dataset.state==='connected');
    await page.click('#wallet');await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet');
    assert.equal(await page.$$eval('.wallet-mint-mini',n=>n.length),0,'A completed mint must leave the in-progress strip');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('myfriends:mint-intent:v1:')).length),1,'Hidden recovery must survive locally in case canonical history is reorganized');
    assert.ok(await page.$$eval('.wallet-friend-mini:not(.wallet-mint-mini)',n=>n.length)>0,'A completed mint belongs in the wallet collection strip');
    await click('VIEW MY FRIENDS');
    // A prepared look is not reserved. Explicitly abandoning it removes only
    // the browser recovery record and never requests a purchase transaction.
    const mintedBeforeAbandon=await nft.totalMinted();
    await page.evaluate(()=>{location.hash='#genotype=6,0,6,0,0,0'});
    await page.waitForFunction(()=>myFriendsUI.genotype().join(',')==='6,0,6,0,0,0');
    await clickMint();await screen('start');await clickAction('commit');await screen('waiting');
    assert.equal(sent.length,3,'Preparing another look adds only its commit transaction');
    await page.click('#closeMint');await page.click('#wallet');
    await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet'&&document.querySelector('.wallet-mint-mini'));
    assert.equal(await page.$$eval('.wallet-mint-mini',n=>n.length),1);
    assert.equal(await page.$$eval('.wallet-mint-remove',n=>n.length),1,'A prepared mint has a compact remove control in Wallet Menu');
    await page.click('.wallet-mint-remove');await page.waitForSelector('.wallet-remove-dialog[open]');
    assert.match(await page.$eval('.wallet-remove-dialog',e=>e.textContent),/preparation transaction and its gas cannot be undone/i);
    assert.equal(await page.$$eval('.wallet-mint-mini',n=>n.length),1,'Opening confirmation must not remove the mint');
    await page.click('.wallet-remove-confirm');
    await page.waitForFunction(()=>document.querySelector('#mintTitle')?.textContent==='Your wallet'&&!document.querySelector('.wallet-remove-dialog'));
    assert.equal(await page.$$eval('.wallet-mint-mini',n=>n.length),0,'Abandoned mint must disappear from Wallet Menu');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('myfriends:mint-intent:v1:')).length),1,'Abandoning must remove its own record while preserving the hidden reorg recovery');
    assert.equal(await nft.isAvailable(6,0,6,0,0,0),true,'A commitment never reserves its selected combination');
    assert.equal(await nft.totalMinted(),mintedBeforeAbandon,'Abandoning after commit must not purchase an NFT');
    assert.deepEqual(errors,[]);
    console.log('PASS: actual website, commit/reveal retry labels, close at final nonce boundary, wallet-change recovery, read-only manual checks, early clock cannot bypass maturity, gas-backed Wallet Menu recovery with confirmed compact removal, pending/review/success reload, metro progress, no purchase-status quote, opt-in price buffer and automatic-refund explanation, 1440/390/320px layout, receipt-backed ownership, confetti/download/share, no duplicate mint.');
  }catch(error){
    console.log('Public UI failure:',await page.evaluate(()=>({title:document.querySelector('#mintTitle')?.textContent,screen:document.querySelector('#mintBody')?.dataset.mintScreen,status:document.querySelector('#chainStatus')?.textContent})),errors);
    await mkdir(`${previewRoot}/diagnostics`,{recursive:true});
    await page.screenshot({path:`${previewRoot}/diagnostics/public-failure.png`});throw error;
  }finally{await page.close()}
}
