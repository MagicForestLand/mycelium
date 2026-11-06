import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const base=process.env.SITE_URL||'http://127.0.0.1:4173/';
let server,browser;
try{
  try{await fetch(base,{signal:AbortSignal.timeout(750)});}
  catch{
    server=spawn(process.execPath,['tooling/dev/serve.mjs'],{stdio:'ignore'});
    for(let i=0;i<50;i++){
      try{await fetch(base,{signal:AbortSignal.timeout(500)});break;}
      catch{if(i===49)throw Error('Local site did not start');await new Promise(r=>setTimeout(r,100));}
    }
  }
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',r=>r.url().includes('/assets/web3/')?r.respond({status:200,contentType:'application/javascript',body:'export {};'}):r.url().includes('/api/mycelium/minter-avatar/')?r.respond({status:200,contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#79f7ff"/></svg>'}):r.url().includes('api.coingecko.com')?r.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})}):!r.url().startsWith(base)?r.abort():r.continue());
  await page.setViewport({width:1440,height:1000});
  await page.goto(base);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  assert.equal(await page.$eval('#stage',stage=>stage.classList.contains('spiral-loading')),true,'The empty spiral animates while collection state is loading');
  assert.notEqual(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationName),'none');
  assert.ok(await page.$eval('#mainSpiral',path=>Number.parseFloat(getComputedStyle(path).strokeDashoffset)>0),'The completed path must remain masked while the artist stroke is still drawing');
  assert.equal(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationIterationCount),'1','Loading thread draws only once');
  assert.equal(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationDuration),'3.2s','The empty thread should have time to draw visibly');
  const seed=async (count,ready=true,profileName='Forest Keeper',withProfile=true,blockNumber=count)=>page.evaluate(({count,ready,profileName,withProfile,blockNumber})=>{
    const owner='0x1111111111111111111111111111111111111111';
    const records=Array.from({length:count},(_,i)=>({tokenId:String(i+1),genotype:[i%8,i%20,0,i%10,0,0],price:i?'100000000000000':'0',phase:i?'public':'allowlist',step:i+1,buyer:owner,owner,transactionHash:'0x'+i,blockNumber:1}));
    const profiles=withProfile?{[owner]:{displayName:profileName,source:'magic_forest',profileUrl:'https://x.com/forestkeeper',avatarUrl:'https://magicforest.land/api/mycelium/minter-avatar/'+owner}}:{};
    window.__spiralFixture={ready,busy:false,walletChecking:false,deployment:{id:'spiral-fixture',chainId:1,address:'0x49f3A83a8EE0B1BB4334c5Fa997565926234648F',explorerUrl:'https://etherscan.io'},profiles,snapshot:{records,total:count,cap:10000,price:'100000000000000',publicOpen:true,salePhase:2,blockNumber}};
    window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__spiralFixture}));
  },{count,ready,profileName,withProfile,blockNumber});
  await page.evaluate(()=>{
    window.__spiralThreadHandoffs=[];
    new MutationObserver(()=>{const stage=document.querySelector('#stage');if(stage.classList.contains('spiral-loading')||window.__spiralThreadHandoffs.length)return;const handoff={phase:document.body.dataset.spiralIntro,latest:false,current:Boolean(document.querySelector('#nodes [data-slot="21"]')),frames:0};window.__spiralThreadHandoffs.push(handoff);const probe=()=>{handoff.latest=Boolean(document.querySelector('#nodes [data-slot="20"]'));if(!handoff.latest&&handoff.frames<10){handoff.frames++;requestAnimationFrame(probe);}};probe();}).observe(document.querySelector('#stage'),{attributes:true,attributeFilter:['class']});
  });
  await seed(20,false);
  assert.deepEqual(await page.$eval('#previewMint',button=>({disabled:button.disabled,hidden:button.hidden,text:button.textContent.trim()})),
    {disabled:true,hidden:false,text:'RECONNECTING…'},'A cached snapshot remains visible, but Mint waits for fresh chain readiness');
  assert.equal(await page.$eval('#mint',button=>button.disabled),true,'The canonical sidebar Mint action is also unavailable while reconnecting');
  assert.equal(await page.$eval('#stage',stage=>stage.classList.contains('spiral-loading')),true,'The empty thread finishes before cached/API mushrooms enter');
  assert.equal(await page.$eval('body',body=>body.dataset.spiralIntro),'waiting');
  assert.equal(await page.$('#nodes [data-slot="20"]'),null,'Mushrooms wait for the empty thread to fill the viewport');
  await page.waitForFunction(()=>!document.querySelector('#stage').classList.contains('spiral-loading'));
  const threadFinished=Date.now();
  const visibleTurns=await page.$eval('#stage',stage=>Number(stage.dataset.visibleTurns));
  const sourceTurns=await page.$eval('#stage',stage=>Number(stage.dataset.turns));
  assert.ok(visibleTurns>2&&visibleTurns<3&&sourceTurns>visibleTurns,'The intro should stop after the roughly two-and-a-half visible turns, before the offscreen safety tail');
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='minted');
  await page.waitForSelector('#nodes [data-slot="20"]');
  await page.waitForFunction(()=>window.__spiralThreadHandoffs[0]?.latest);
  const threadHandoff=(await page.evaluate(()=>window.__spiralThreadHandoffs))[0];
  assert.equal(threadHandoff.phase,'minted');assert.equal(threadHandoff.current,false);assert.ok(threadHandoff.frames<=2,'The completed thread hands off to the latest mushroom within two presentation frames: '+JSON.stringify(threadHandoff));
  const birthDistance=await page.evaluate(()=>{
    const stage=document.querySelector('#stage'),area=document.querySelector('#universe').getBoundingClientRect(),node=document.querySelector('#nodes [data-slot="20"]').getBoundingClientRect();
    return Math.hypot(node.left+node.width/2-area.left-Number(stage.dataset.originX),node.top+node.height/2-area.top-Number(stage.dataset.originY));
  });
  assert.ok(birthDistance<35,'The latest mushroom must emerge from the star at the visible origin of the thread');
  assert.equal(await page.$('#nodes [data-slot="1"]'),null,'The latest mint must leave the centre first');
  assert.equal(await page.$('#nodes [data-slot="21"]'),null,'The current mint waits for minted mushrooms');
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='current');
  assert.ok(await page.$('#nodes [data-slot="21"].coming.intro-current'),'The existing current-mint design fades in after minted mushrooms');
  assert.equal(await page.$('#nodes [data-slot="22"]'),null,'Future positions wait for the current mint');
  await page.waitForSelector('#nodes [data-slot="22"].intro-future');
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='done');
  assert.equal(await page.$$eval('#nodes .node',nodes=>nodes.every(node=>node.getAttribute('aria-label').startsWith(node.querySelector('.index').textContent+' · '))),true,'Every Spiral node accessible name includes its visible position label');
  assert.ok(Date.now()-threadFinished>=6000,'The mushroom sequence should remain calm enough to watch');
  const introFill=await page.evaluate(()=>({future:[...document.querySelectorAll('#nodes .node.empty:not(.coming)')].length,total:Number(document.querySelector('#stage').dataset.totalPositions),travelMax:Number(document.querySelector('#spiralScrub').max),minted:20,capacity:Number(document.querySelector('#stage').dataset.capacity)}));
  assert.ok(introFill.total-introFill.minted-1>5,'Future position count must be based on viewport capacity');
  assert.equal(introFill.travelMax,introFill.minted,'Transport must stop with the last rendered mushroom, before the empty tail');
  assert.ok(introFill.future>5,'Future positions fill the remaining visible spiral');
  await mkdir('output/previews/spiral',{recursive:true});
  await (await page.$('#universe')).screenshot({path:'output/previews/spiral/intro-complete.png'});
  await seed(20,true);
  assert.equal(await page.$eval('body',body=>body.dataset.spiralIntro),'done','Network verification must not replay a cached intro');
  await page.waitForFunction(()=>{const button=document.querySelector('#previewMint');return button&&!button.disabled&&button.textContent.includes('≈ $0.25');});
  assert.equal(await page.$eval('#mint',button=>button.disabled),false,'Fresh chain readiness restores the canonical Mint action');
  const mintButton=await page.$eval('#previewMint',button=>{const usd=button.querySelector('.mint-usd'),buttonStyle=getComputedStyle(button),usdStyle=getComputedStyle(usd);return {text:button.textContent,overflow:button.scrollWidth>button.clientWidth,sameStyle:['fontSize','fontWeight','color','letterSpacing','textTransform'].every(key=>buttonStyle[key]===usdStyle[key])};});
  assert.match(mintButton.text,/MINT MYFRIEND · 0\.0001 ETH ≈ \$0\.25/,'The compact sidebar mint button includes the approximate USD price after chain readiness recovers');
  assert.equal(mintButton.overflow,false,'The mint price and USD estimate must fit without the decorative arrow');
  assert.equal(mintButton.sameStyle,true,'The USD estimate uses the same typography as the rest of the mint button');

  await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.evaluate(()=>{
    window.__emptyThreadHandoffs=[];
    new MutationObserver(()=>{const stage=document.querySelector('#stage');if(stage.classList.contains('spiral-loading')||window.__emptyThreadHandoffs.length)return;const handoff={phase:document.body.dataset.spiralIntro,next:false,frames:0};window.__emptyThreadHandoffs.push(handoff);const probe=()=>{handoff.next=Boolean(document.querySelector('#nodes [data-slot="1"].coming.intro-current'));if(!handoff.next&&handoff.frames<10){handoff.frames++;requestAnimationFrame(probe);}};probe();}).observe(document.querySelector('#stage'),{attributes:true,attributeFilter:['class']});
  });
  await seed(0,false);
  await page.waitForFunction(()=>!document.querySelector('#stage').classList.contains('spiral-loading'));
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='current'&&document.querySelector('#nodes [data-slot="1"].coming.intro-current'));
  await page.waitForFunction(()=>window.__emptyThreadHandoffs[0]?.next);
  const emptyThreadHandoff=(await page.evaluate(()=>window.__emptyThreadHandoffs))[0];
  assert.equal(emptyThreadHandoff.phase,'current');assert.ok(emptyThreadHandoff.frames<=2,'An empty collection hands the completed thread to NEXT within two presentation frames: '+JSON.stringify(emptyThreadHandoff));

  await seed(80);
  await page.click('#reset');await page.hover('#nodes [data-slot="1"]');
  await page.waitForFunction(()=>document.querySelector('#tipOwnerAvatar').naturalWidth>0);
  assert.deepEqual(await page.$eval('#slotTooltip',tip=>({owner:tip.querySelector('#tipOwnerName').textContent,ownerVisible:!tip.querySelector('#tipOwner').hidden,priceHidden:tip.querySelector('#tipPrice').hidden,avatar:tip.querySelector('#tipOwnerAvatar').naturalWidth>0,avatarSource:tip.querySelector('#tipOwnerAvatar').src.startsWith('blob:'),interactive:tip.classList.contains('is-interactive'),pointerEvents:getComputedStyle(tip).pointerEvents})),{owner:'Forest Keeper',ownerVisible:true,priceHidden:true,avatar:true,avatarSource:true,interactive:true,pointerEvents:'auto'},'A free minted mushroom replaces the large FREE CLAIM value with a compact, clickable owner identity and a CSP-safe fetched avatar');
  await page.hover('#tipOwner');await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(await page.$eval('#slotTooltip',tip=>tip.classList.contains('visible')),true,'The hover tooltip stays open while the pointer moves from the mushroom to its owner link');
  await page.click('#nodes [data-slot="1"]');
  assert.deepEqual(await page.$eval('#slotTooltip',tip=>({pinned:tip.classList.contains('is-pinned'),pointerEvents:getComputedStyle(tip).pointerEvents,href:tip.querySelector('#tipOwner').href})),{pinned:true,pointerEvents:'auto',href:'https://x.com/forestkeeper'},'A pinned Spiral tooltip exposes the owner profile as a real clickable link');
  assert.deepEqual(await page.$eval('#contextPanel .minted-owner',owner=>({name:owner.querySelector('.minted-owner-name').textContent,href:owner.href,avatar:owner.querySelector('img')?.naturalWidth>0,avatarSource:owner.querySelector('img')?.src.startsWith('blob:'),height:owner.getBoundingClientRect().height,fontSize:Number.parseFloat(getComputedStyle(owner.querySelector('.minted-owner-name')).fontSize),loud:/CURRENT OWNER|MINTED BY|MINT PRICE|STEP [0-9]+/.test(owner.parentElement.textContent),purchaseBox:Boolean(owner.parentElement.querySelector('.purchase-box'))})),{name:'Forest Keeper',href:'https://x.com/forestkeeper',avatar:true,avatarSource:true,height:34,fontSize:13,loud:false,purchaseBox:false},'Desktop token information shows a readable but quiet avatar-and-name owner link without redundant mint price and phase boxes');
  await seed(80,true,'B'.repeat(80));
  assert.equal(await page.$eval('#contextPanel',panel=>panel.scrollWidth<=panel.clientWidth),true,'The longest valid profile display name must wrap inside the desktop token sidebar');
  await seed(80);await page.waitForFunction(()=>document.querySelector('#contextPanel .minted-owner img')?.naturalWidth>0);
  await (await page.$('#contextPanel')).screenshot({path:'output/previews/spiral/owner-sidebar.png'});
  await page.evaluate(()=>window.myFriendsUI.forest());await page.waitForSelector('#gallery .collection-card');
  assert.deepEqual(await page.$eval('#gallery .collection-card',card=>{const avatar=card.querySelector('.collection-owner-avatar').getBoundingClientRect(),ownerName=card.querySelector('.collection-owner-name').getBoundingClientRect(),price=card.querySelector('.collection-mint'),label=price.querySelector('dt').getBoundingClientRect(),value=price.querySelector('dd'),valueRect=value.getBoundingClientRect();return {avatar:avatar.width,nameSize:Number.parseFloat(getComputedStyle(card.querySelector('.collection-owner-name')).fontSize),priceSize:Number.parseFloat(getComputedStyle(value).fontSize),priceFits:value.scrollWidth<=value.clientWidth,leftAligned:Math.abs(label.left-valueRect.left)<1,ownerPriceLevel:Math.abs((ownerName.top+ownerName.bottom)/2-(valueRect.top+valueRect.bottom)/2)<1};}),{avatar:31,nameSize:11,priceSize:10,priceFits:true,leftAligned:true,ownerPriceLevel:true},'Desktop Collection keeps the original left-aligned price cell while placing the mint price on the owner-name level');
  await (await page.$('#forest-view')).screenshot({path:'output/previews/spiral/collection-desktop.png'});
  await seed(80,true,'Forest Keeper',false);await page.waitForFunction(()=>document.querySelector('#gallery .collection-owner-avatar canvas')?.classList.contains('painted'));
  assert.deepEqual(await page.$eval('#gallery .collection-card',card=>({image:Boolean(card.querySelector('.collection-owner-avatar img')),fallback:card.querySelector('.collection-owner-avatar canvas').dataset.genotype,painted:card.querySelector('.collection-owner-avatar canvas').classList.contains('painted')})),{image:false,fallback:'7,19,0,9,0,0',painted:true},'An owner without a profile avatar falls back to that token\'s mushroom artwork');
  await (await page.$('#forest-view')).screenshot({path:'output/previews/spiral/collection-owner-fallback.png'});
  await seed(80);await page.waitForFunction(()=>document.querySelector('#gallery .collection-owner img')?.naturalWidth>0);
  await page.setViewport({width:320,height:900});await page.evaluate(()=>window.myFriendsUI.forest());await page.waitForSelector('#gallery .collection-card');
  await page.waitForFunction(()=>document.querySelector('#gallery .collection-owner img')?.naturalWidth>0);
  assert.deepEqual(await page.$eval('#gallery .collection-card',card=>({token:card.querySelector('.forest-label span').textContent,index:card.dataset.minted,facts:[...card.querySelectorAll('.collection-card-meta dt')].map(node=>node.textContent),owner:card.querySelector('.collection-owner-name').textContent,avatar:card.querySelector('.collection-owner img').naturalWidth>0,avatarSource:card.querySelector('.collection-owner img').src.startsWith('blob:'),metaDisplay:getComputedStyle(card.querySelector('.collection-card-meta')).display,overflow:card.scrollWidth>card.clientWidth})),{token:'#80',index:'79',facts:['OWNER','MINT PRICE'],owner:'Forest Keeper',avatar:true,avatarSource:true,metaDisplay:'block',overflow:false},'Narrow mobile Collection starts with the newest creation and keeps only the profiled current owner and CSP-safe avatar plus mint price');
  assert.deepEqual(await page.$eval('#collectionSort',button=>({text:button.textContent.trim(),label:button.getAttribute('aria-label'),order:button.dataset.order,pressed:button.hasAttribute('aria-pressed'),height:button.getBoundingClientRect().height})),{text:'NEWEST FIRST',label:'Newest first. Show oldest first',order:'newest',pressed:false,height:44},'Collection exposes one touch-sized creation-order control whose accessible name includes its visible state and next action');
  await page.click('#collectionSort');
  assert.deepEqual(await page.evaluate(()=>{const card=document.querySelector('#gallery .collection-card'),button=document.querySelector('#collectionSort');return {token:card.querySelector('.forest-label span').textContent,index:card.dataset.minted,label:button.getAttribute('aria-label'),order:button.dataset.order};}),{token:'#1',index:'0',label:'Oldest first. Show newest first',order:'oldest'},'The same control switches Collection to oldest-first without losing its accessible state or source token index');
  await page.click('#collectionSort');
  assert.equal(await page.$eval('#gallery .collection-card .forest-label span',node=>node.textContent),'#80','The toggle returns Collection to newest-first');
  await page.click('[data-mobile-destination="about"]');await page.waitForFunction(()=>document.body.dataset.view==='about');
  assert.deepEqual(await page.$$eval('.about-mobile-primary-links a:not([hidden])',nodes=>nodes.map(node=>({label:node.textContent.trim(),icon:node.querySelector('use')?.getAttribute('href'),href:node.href}))),[
    {label:'OPENSEA',icon:'#icon-opensea',href:'https://opensea.io/collection/mycelium-friends?sortBy=created_date&sortDirection=desc'},
    {label:'TWITTER',icon:'#icon-twitter',href:'https://twitter.com/MagicForestLand'},
    {label:'GITHUB',icon:'#icon-github',href:'https://github.com/MagicForestLand/mycelium/'}
  ],'Mobile About shows exactly OpenSea, the Twitter bird and GitHub, in that order');
  assert.deepEqual(await page.$$eval('.about-footer-links',nodes=>nodes.map(node=>getComputedStyle(node).display)),['block','block'],'Mobile About preserves its existing Contacts and Collection link groups');
  await page.click('[data-mobile-destination="spiral"]');await page.waitForFunction(()=>document.body.dataset.view==='spiral'&&document.body.dataset.mobileSurface==='spiral');await page.setViewport({width:1440,height:1000});
  await page.click('#reset');
  let outsidePositionObserved=false;
  for(const width of [1440,1024,768,390,320]){
    console.log(`CHECK: Archimedean spiral at ${width}px`);
    await page.setViewport({width,height:width<760?900:1000});
    if(width<=820&&await page.$eval('body',body=>body.dataset.mobileSurface!=='spiral')){
      await page.click('[data-mobile-destination="spiral"]');
      await page.waitForFunction(()=>document.body.dataset.mobileSurface==='spiral');
    }
    await page.click('#reset');
    await page.waitForFunction(()=>Math.abs(document.querySelector('#stage svg').viewBox.baseVal.width-document.querySelector('#universe').clientWidth)<1);
    const geometry=await page.evaluate(()=>{
      const u=document.querySelector('#universe').getBoundingClientRect();
      const nodes=[...document.querySelectorAll('#nodes .node')].map(n=>{const r=n.getBoundingClientRect();return {slot:n.dataset.slot,x:r.x-u.x,y:r.y-u.y,w:r.width,h:r.height};});
      const stage=document.querySelector('#stage'),origin=[Number(stage.dataset.originX),Number(stage.dataset.originY)];
      const pathStart=document.querySelector('#mainSpiral').getAttribute('d').match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
      const first=document.querySelector('#nodes [data-slot="1"]')?.getBoundingClientRect(),star=document.querySelector('#originStar');
      const firstCentre=first?[first.left+first.width/2-u.left,first.top+first.height/2-u.top]:null;
      return {width:u.width,height:u.height,nodes,origin,pathStart,firstCentre,starTransform:star.getAttribute('transform'),starOpacity:getComputedStyle(star).opacity,capacity:Number(stage.dataset.capacity),overflow:document.documentElement.scrollWidth>innerWidth,transform:getComputedStyle(stage).transform};
    });
    assert.equal(geometry.overflow,false);assert.equal(geometry.transform,'none');
    assert.ok(geometry.nodes.length<=geometry.capacity+1);
    assert.ok(Math.abs(geometry.origin[0]-geometry.width/2)<.01);
    assert.ok(Math.abs(geometry.origin[1]-geometry.height/2)<.01);
    assert.ok(Math.hypot(geometry.pathStart[0]-geometry.origin[0],geometry.pathStart[1]-geometry.origin[1])<.01,'The thread must extend to the mushroom birth point');
    assert.match(geometry.starTransform,new RegExp(`translate\\(${geometry.origin[0].toFixed(2)} ${geometry.origin[1].toFixed(2)}\\)`));
    assert.equal(geometry.starOpacity,'1','The origin star remains visible after the intro');
    assert.ok(Math.hypot(geometry.firstCentre[0]-geometry.origin[0],geometry.firstCentre[1]-geometry.origin[1])>20,'The first resting mushroom keeps its established spiral position');
    outsidePositionObserved ||= geometry.nodes.some(n=>n.x+n.w<0||n.y+n.h+19<0||n.x>geometry.width||n.y>geometry.height);
    const universe=await page.$('#universe');
    await universe.screenshot({path:`output/previews/spiral/${width}.png`});
  }
  assert.equal(outsidePositionObserved,true,'Offscreen mushroom positions remain mounted');
  await page.setViewport({width:390,height:900});
  await seed(79,true,'Forest Keeper',true,179);
  await page.click('#reset');
  await page.waitForFunction(()=>document.querySelectorAll('#nodes .node:not(.empty).spiral-art-pending').length===0);
  await page.evaluate(()=>{
    window.__spiralRevealAnimations=[];window.__spiralAnimate=Element.prototype.animate;
    Element.prototype.animate=function(...args){const animation=window.__spiralAnimate.apply(this,args);if(this.closest('#nodes'))window.__spiralRevealAnimations.push({animation,slot:Number(this.dataset.slot),createdAt:document.timeline.currentTime});return animation;};
  });
  const mobilePinch=await page.$eval('#universe',async universe=>{
    const retryGate=document.head.appendChild(document.createElement('style'));retryGate.textContent='.node.spiral-art-pending{display:none!important}';
    const rect=universe.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    const fire=(type,pointerId,clientX)=>universe.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId,pointerType:'touch',button:0,clientX,clientY:y}));
    fire('pointerdown',101,x-100);fire('pointerdown',102,x+100);fire('pointermove',102,x-60);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const minted=[...document.querySelectorAll('#nodes .node:not(.empty)')];
    const visibleBlank=minted.filter(node=>getComputedStyle(node).visibility!=='hidden'&&!node.querySelector('canvas')?.dataset.genotype).length;
    await new Promise(resolve=>setTimeout(resolve,180));
    const result={zoom:document.querySelector('#zoomLevel').textContent,capacity:Number(document.querySelector('#stage').dataset.capacity),minted:minted.length,pending:minted.filter(node=>node.classList.contains('spiral-art-pending')).length,visibleBlank};
    retryGate.remove();
    fire('pointerup',102,x-60);fire('pointerup',101,x-100);return result;
  });
  assert.equal(mobilePinch.zoom,'20%','A mobile pinch can return to the complete 20% collection overview');
  assert.ok(mobilePinch.capacity>=79,'The 20% camera has room for the complete live collection');
  assert.ok(mobilePinch.pending>0,'Artwork without a temporary layout box remains queued for retry');
  assert.equal(mobilePinch.visibleBlank,0,'Queued mobile artwork stays hidden instead of exposing empty minted circles');
  await page.waitForFunction(()=>{
    const minted=[...document.querySelectorAll('#nodes .node:not(.empty)')];
    return minted.length===79&&minted.every(node=>node.classList.contains('spiral-art-ready')&&node.querySelector('canvas')?.dataset.genotype);
  });
  const mobileReveal=await page.$$eval('#nodes .node:not(.empty)',nodes=>({
    minted:nodes.length,
    visibleBlank:nodes.filter(node=>getComputedStyle(node).visibility!=='hidden'&&!node.querySelector('canvas')?.dataset.genotype).length,
    futures:document.querySelectorAll('#nodes .node.empty:not(.coming)').length,
    total:document.querySelectorAll('#nodes .node').length
  }));
  assert.equal(mobileReveal.minted,79,'All 79 minted mushrooms remain reachable in the mobile overview');
  assert.equal(mobileReveal.visibleBlank,0);
  assert.ok(mobileReveal.futures<=6&&mobileReveal.total<=86,'Mobile keeps NEXT and a six-position future tail instead of filling the overview with placeholders');
  const revealCadence=await page.evaluate(()=>{
    const starts=window.__spiralRevealAnimations.map(item=>({slot:item.slot,createdAt:item.createdAt,delay:item.animation.effect.getTiming().delay}));
    Element.prototype.animate=window.__spiralAnimate;return starts;
  });
  // All starts share one clock and follow the Spiral's numbered order. Canvas
  // retries may move the remaining sequence forward, but never reorder it.
  assert.ok(revealCadence.length>=2);
  assert.ok(revealCadence.every((item,index)=>index===0||item.slot>revealCadence[index-1].slot),'Mobile mushrooms reveal one by one in increasing Spiral position order');
  assert.ok(revealCadence.every((item,index)=>index===0||item.createdAt-revealCadence[index-1].createdAt>=100),'Consecutive mushroom fades are created on distinct presentation frames without pair-like starts');
  assert.ok(revealCadence.every(item=>item.delay===0),'Mobile mushroom fades begin on their creation frame without a queued WAAPI delay');
  await (await page.$('#universe')).screenshot({path:'output/previews/spiral/mobile-overview-20.png'});
  await page.click('[data-mobile-destination="about"]');
  await page.click('[data-mobile-destination="spiral"]');
  await page.waitForFunction(()=>{
    const minted=[...document.querySelectorAll('#nodes .node:not(.empty)')];
    return minted.length===79&&minted.every(node=>node.classList.contains('spiral-art-ready')&&node.querySelector('canvas')?.dataset.genotype);
  });
  assert.equal(await page.$$eval('#nodes .node:not(.empty)',nodes=>nodes.filter(node=>getComputedStyle(node).visibility!=='hidden'&&!node.querySelector('canvas')?.dataset.genotype).length),0,'Leaving and returning to Spiral retains prepared artwork without a blank flash');
  await page.evaluate(()=>{window.__spiralCachedNodes=[...document.querySelectorAll('#nodes .node')];});
  const firstCollection=await page.evaluate(()=>{
    const previous=document.querySelector('#gallery').firstElementChild;
    window.myFriendsUI.forest();
    return {visible:!document.querySelector('#forest-view').hidden,deferred:document.querySelector('#gallery').firstElementChild===previous,busy:document.querySelector('#gallery').getAttribute('aria-busy')};
  });
  assert.deepEqual(firstCollection,{visible:true,deferred:true,busy:'true'},'Mobile Collection opens its shell before constructing changed cards');
  await page.waitForFunction(()=>!document.querySelector('#gallery').hasAttribute('aria-busy')&&document.querySelector('#gallery .forest-label span')?.textContent==='#79');
  await page.waitForFunction(()=>document.querySelector('#gallery [data-profile-avatar]')?.naturalWidth>0);
  assert.equal(await page.$$eval('#gallery [data-owner-art]',nodes=>nodes.filter(node=>node.classList.contains('painted')).length),0,'A real mobile owner avatar does not eagerly paint hidden fallback canvases');
  await page.evaluate(()=>{window.__collectionCachedCard=document.querySelector('#gallery').firstElementChild;});
  await page.click('[data-mobile-destination="spiral"]');
  await page.waitForFunction(()=>document.body.dataset.mobileSurface==='spiral'&&!document.querySelector('#universe').hidden);
  assert.equal(await page.evaluate(()=>window.__spiralCachedNodes.every(node=>node.isConnected&&document.querySelector(`#nodes [data-slot="${node.dataset.slot}"]`)===node)&&document.querySelector('#nodes').getAnimations({subtree:true}).length===0),true,'Returning preserves every prepared Spiral node without a second fade');
  for(let i=0;i<3;i++){
    await page.evaluate(()=>window.myFriendsUI.forest());await page.click('[data-mobile-destination="spiral"]');
  }
  await page.evaluate(()=>window.myFriendsUI.forest());
  assert.equal(await page.evaluate(()=>window.__collectionCachedCard===document.querySelector('#gallery').firstElementChild),true,'Rapid unchanged toggles reuse Collection cards');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__spiralFixture})));
  assert.equal(await page.evaluate(()=>window.__collectionCachedCard===document.querySelector('#gallery').firstElementChild),true,'An unchanged snapshot does not rebuild cached cards');
  await page.$eval('#gallery [data-profile-avatar]',image=>image.onerror(new Event('error')));
  await page.waitForFunction(()=>document.querySelector('#gallery [data-owner-art]').classList.contains('painted'));
  assert.equal(await page.$eval('#gallery [data-profile-avatar]',image=>image.hidden&&image.dataset.avatarFailed==='true'),true,'A failed real avatar reveals its lazily painted mushroom fallback');
  await seed(79,true,'Updated Keeper',true,180);
  await page.waitForFunction(()=>document.querySelector('#gallery .collection-owner-name')?.textContent==='Updated Keeper');
  assert.equal(await page.evaluate(()=>window.__collectionCachedCard===document.querySelector('#gallery').firstElementChild),false,'Profile changes invalidate the Collection cache');
  await seed(80,true,'Updated Keeper',true,181);
  await page.waitForFunction(()=>document.querySelector('#gallery .forest-label span')?.textContent==='#80');
  await page.click('[data-mobile-destination="spiral"]');
  await page.waitForFunction(()=>document.querySelectorAll('#nodes .node:not(.empty)').length===80&&document.querySelectorAll('#nodes .spiral-art-pending').length===0);
  const hiddenScene=await page.evaluate(()=>{
    window.__spiralCachedNodes=[...document.querySelectorAll('#nodes .node')];
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    return {retained:window.__spiralCachedNodes.every(node=>node.isConnected),animations:document.querySelector('#nodes').getAnimations({subtree:true}).length};
  });
  assert.deepEqual(hiddenScene,{retained:true,animations:0},'Backgrounding retains bounded ready artwork and cancels active fades');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await seed(79,true,'Updated Keeper',true,182);
  await page.waitForFunction(()=>document.querySelectorAll('#nodes .node:not(.empty)').length===79&&document.querySelectorAll('#nodes .spiral-art-pending').length===0);
  await page.waitForFunction(()=>document.querySelector('#nodes').getAnimations({subtree:true}).length===0);
  assert.equal(await page.$eval('#nodes',node=>node.getAnimations({subtree:true}).length),0,'Reduced motion paints the same complete scene without reveal animations');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await page.setViewport({width:1440,height:1000});await page.click('#reset');
  const zoomGeometry=()=>page.evaluate(()=>({origin:[document.querySelector('#stage').dataset.originX,document.querySelector('#stage').dataset.originY].join(','),turns:Number(document.querySelector('#stage').dataset.turns),capacity:Number(document.querySelector('#stage').dataset.capacity)}));
  const normal=await zoomGeometry();
  await page.click('#zoomOut');const far=await zoomGeometry();
  await page.click('#reset');await page.click('#zoomIn');const near=await zoomGeometry();
  assert.equal(far.origin,normal.origin);assert.equal(near.origin,normal.origin);
  assert.ok(far.turns>normal.turns&&normal.turns>near.turns);
  assert.ok(far.capacity>normal.capacity&&normal.capacity>near.capacity);
  await page.click('#reset');
  for(let i=0;i<9;i++)await page.click('#zoomOut');
  const overviewSizes=await page.evaluate(()=>({
    zoom:document.querySelector('#zoomLevel').textContent,
    mushroom:document.querySelector('#nodes .node:not(.empty)')?.getBoundingClientRect().width||0,
    future:document.querySelector('#nodes .node.empty:not(.coming)')?.getBoundingClientRect().width||0,
    next:document.querySelector('#nodes .node.coming')?.getBoundingClientRect().width||0
  }));
  assert.deepEqual(overviewSizes,{zoom:'20%',mushroom:42,future:24,next:42},'Overview keeps artwork readable without enlarging every empty landing place');
  await (await page.$('#universe')).screenshot({path:'output/previews/spiral/overview-20.png'});
  await page.click('#reset');
  await page.click('#zoomIn');await page.click('#zoomIn');await page.click('#zoomIn');await page.click('#zoomIn');
  const closeNodes=await page.$eval('#universe',universe=>{
    const area=universe.getBoundingClientRect(),nodes=[...document.querySelectorAll('#nodes .node')].map(node=>node.getBoundingClientRect());
    return {mounted:nodes.length,visible:nodes.filter(r=>r.right>area.left&&r.left<area.right&&r.bottom>area.top&&r.top<area.bottom).length,size:nodes[0]?.width||0};
  });
  assert.ok(closeNodes.mounted>3&&closeNodes.visible>3&&closeNodes.size>=90,`Close camera should keep large populated positions: ${JSON.stringify(closeNodes)}`);
  await page.click('#reset');
  assert.deepEqual(await page.$$eval('.spiral-transport > *',nodes=>nodes.map(node=>node.id)),['spiralScrub','spiralPosition','spiralLatest']);
  const path=await page.$eval('#mainSpiral',n=>n.getAttribute('d'));
  await page.$eval('#spiralScrub',n=>{n.value=3;n.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.$eval('#spiralScrub',n=>Number(n.value)),3);
  assert.equal(await page.$eval('#mainSpiral',n=>n.getAttribute('d')),path,'Browsing must not move the thread');
  await page.$eval('#universe',n=>n.dispatchEvent(new WheelEvent('wheel',{deltaY:900,bubbles:true,cancelable:true})));
  await page.waitForFunction(()=>Number(document.querySelector('#spiralScrub').value)>7.8);
  await page.click('#zoomIn');assert.equal(await page.$eval('#zoomLevel',n=>n.textContent),'120%');
  await page.click('#reset');assert.equal(await page.$eval('#zoomLevel',n=>n.textContent),'100%');
  const area=await page.$eval('#universe',n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(area.x+area.w*.7,area.y+area.h*.45);await page.mouse.down();
  await page.mouse.move(area.x+area.w*.7-130,area.y+area.h*.45,{steps:8});await page.mouse.up();
  assert.ok(Math.abs(await page.$eval('#spiralScrub',n=>Number(n.value))-2)<.05,'Dragging moves mushrooms along the thread');
  assert.equal(await page.$eval('#mainSpiral',n=>n.getAttribute('d')),path);
  await page.$eval('#spiralScrub',n=>{n.value=.99;n.dispatchEvent(new Event('input',{bubbles:true}));});
  const centreArrival=await page.evaluate(()=>{
    const stage=document.querySelector('#stage'),origin=[Number(stage.dataset.originX),Number(stage.dataset.originY)];
    const area=document.querySelector('#universe').getBoundingClientRect(),node=document.querySelector('#nodes [data-slot="1"]').getBoundingClientRect();
    return {distance:Math.hypot(node.left+node.width/2-area.left-origin[0],node.top+node.height/2-area.top-origin[1]),opacity:getComputedStyle(document.querySelector('#nodes [data-slot="1"]')).opacity};
  });
  assert.ok(centreArrival.distance<3&&centreArrival.opacity==='1','A mushroom stays opaque until it reaches the origin');
  await page.$eval('#spiralScrub',n=>{n.value=1;n.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.$('#nodes [data-slot="1"]'),null,'A mushroom disappears exactly at the origin');
  await page.click('#spiralLatest');await page.waitForSelector('#nodes .coming');
  await seed(1000);
  await page.$eval('#spiralScrub',n=>{n.value=n.max;n.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.$$eval('#nodes .node:not(.empty)',nodes=>nodes.length),0,'The slider can wind every mushroom into the origin');
  assert.equal(await page.$eval('#spiralScrub',n=>Number(n.max)),1000,'Empty landing places must not extend the transport range');
  await page.$eval('#spiralScrub',n=>{n.value=999;n.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.ok(await page.$('#nodes [data-slot="1001"]'),'Next mint after #1000 must be reachable');
  assert.ok(await page.evaluate(()=>document.querySelectorAll('#nodes .node').length<=Number(document.querySelector('#stage').dataset.capacity)+1));
  await page.click('#nodes [data-slot="1000"]');
  assert.match(page.url(),/#token=1000$/);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.click('#reset');await page.$eval('#spiralScrub',n=>{n.value=3;n.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.$eval('#spiralScrub',n=>Number(n.value)),3);
  await seed(0);await page.click('#reset');
  assert.equal(await page.$eval('#spiralScrub',n=>n.disabled),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: Loading thread fills the viewport promptly; the latest mushroom starts immediately; the calm intro remains continuous; slider, gestures and Next Mint follow the spiral; five widths; 1000-mushroom selection; reduced motion; empty collection.');
}finally{await browser?.close();server?.kill('SIGTERM');}
