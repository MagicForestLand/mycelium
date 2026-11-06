import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {catalogFingerprint} from '../lib/deployment-plan.mjs';
const base=process.env.SITE_URL||'http://127.0.0.1:4173/';
let siteServer;
process.once('exit',()=>{if(siteServer?.exitCode===null)siteServer.kill('SIGTERM');});
if(!process.env.SITE_URL){
 try{const response=await fetch(base,{signal:AbortSignal.timeout(750)});if(!response.ok)throw Error(`HTTP ${response.status}`);}
 catch{
  siteServer=spawn(process.execPath,['tooling/dev/serve.mjs'],{cwd:process.cwd(),stdio:['ignore','inherit','inherit']});
  for(let attempt=0;attempt<50;attempt++){
   if(siteServer.exitCode!==null)throw Error(`Local site server exited with code ${siteServer.exitCode}`);
   try{const response=await fetch(base,{signal:AbortSignal.timeout(500)});if(response.ok)break;}catch{}
   if(attempt===49)throw Error(`Local site server did not become ready at ${base}`);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
}
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const browserProcess=browser.process();
const page=await browser.newPage(),errors=[],checks=[];
const identity='0x'+'00'.repeat(32);
const browserConfig={version:1,projectId:'0'.repeat(32),activeDeployment:'ux-local',deployments:[{
 id:'ux-local',label:'Mint UX check',scenario:'public-zero',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,
 networkName:'myFriends Local',address:'0x1111111111111111111111111111111111111111',rpcUrl:'http://127.0.0.1:1',explorerUrl:'https://explorer.test',explorers:{etherscan:'https://explorer.test',evmNow:'https://evm.now'},deploymentBlock:0,
 deploymentHash:identity,codeHash:identity,catalogHash:catalogFingerprint().sha256
}]};
page.on('pageerror',error=>errors.push(error.message));
await page.setRequestInterception(true);
page.on('request',request=>request.url().endsWith('/chain-config.json')
 ? request.respond({status:200,contentType:'application/json',body:JSON.stringify(browserConfig)})
 : request.url()==='https://magicforest.land/api/progress'
 ? request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({got:9000,goal:100000})})
 : request.url().includes('api.coingecko.com')
 ? request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})})
 : request.url().startsWith('https://www.youtube-nocookie.com/')
 ? request.respond({status:204,contentType:'text/plain',body:''})
 : request.continue());
const ready=async()=>{
 try{return await page.waitForFunction(()=>document.body.dataset.ready==='true');}
 catch(error){
  const context=await page.evaluate(()=>({ready:document.body?.dataset.ready||null,title:document.title,body:document.body?.innerText.slice(0,500)||'',scripts:[...document.scripts].map(script=>script.src||'inline')}));
  throw new AggregateError([error,...errors.map(message=>Error(message))],`The mint UX page did not become ready: ${JSON.stringify(context)}`);
 }
};
const genotype=()=>page.$eval('#preview',node=>node.dataset.genotype);
const faviconState=()=>page.$eval('#favicon',async node=>{
 const image=new Image(),loaded=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});image.src=node.href;await loaded;
 const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);
 const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,corners=[3,canvas.width-4,(canvas.height-4)*canvas.width+3,(canvas.height-4)*canvas.width+canvas.width-4];let visible=0,signature=2166136261;
 for(let index=0;index<pixels.length;index++){if(index%4===3&&pixels[index])visible++;signature=Math.imul(signature^pixels[index],16777619)>>>0;}
 return {type:node.type,genotype:node.dataset.genotype,size:[canvas.width,canvas.height],cornersTransparent:corners.every(index=>pixels[index*4+3]===0),visible,signature};
});
const swipe=async({x,y,width,height},from,to)=>{
 const touch=await page.touchscreen.touchStart(x+width*from,y+height/2);
 for(let step=1;step<=6;step++)await touch.move(x+width*(from+(to-from)*step/6),y+height/2);
 await touch.end();
};
const visibleOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
const progressGoalAlignment=()=>page.$eval('#forestProgress',progress=>{
 const progressRect=progress.getBoundingClientRect(),style=getComputedStyle(progress),contentRight=progressRect.right-Number.parseFloat(style.borderRightWidth)-Number.parseFloat(style.paddingRight);
 const goal=progress.querySelector('.forest-progress-goal'),label=goal.querySelector(':scope > span').getBoundingClientRect(),value=goal.querySelector('strong').getBoundingClientRect();
 return {labelRight:Math.abs(label.right-contentRight)<1,valueRight:Math.abs(value.right-contentRight)<1,textAlign:getComputedStyle(goal).textAlign};
});
const marketCircuitGeometry=()=>page.$eval('.market-loop',loop=>{
 const bridge=loop.querySelector('.market-bridge').getBoundingClientRect(),primary=loop.querySelector('.market-primary').getBoundingClientRect(),secondary=loop.querySelector('.market-secondary').getBoundingClientRect();
 const svg=[...loop.querySelectorAll('.market-circuit')].find(node=>getComputedStyle(node).display!=='none'),rect=svg.getBoundingClientRect(),vertical=svg.classList.contains('market-circuit-mobile');
 const points=['primary','secondary'].map(name=>{const node=svg.querySelector('.market-node-'+name);return new DOMPoint(node.cx.baseVal.value,node.cy.baseVal.value).matrixTransform(node.getScreenCTM());});
 const close=(a,b)=>Math.abs(a-b)<1;
 return {vertical,centered:close((rect.left+rect.right)/2,(bridge.left+bridge.right)/2)&&close((rect.top+rect.bottom)/2,(bridge.top+bridge.bottom)/2),contact:vertical?close(primary.bottom,bridge.top)&&close(secondary.top,bridge.bottom)&&close(points[0].y,primary.bottom)&&close(points[1].y,secondary.top):close(primary.right,bridge.left)&&close(secondary.left,bridge.right)&&close(points[0].x,primary.right)&&close(points[1].x,secondary.left),aligned:vertical?close(points[0].x,(primary.left+primary.right)/2)&&close(points[1].x,(secondary.left+secondary.right)/2):close(points[0].y,(primary.top+primary.bottom)/2)&&close(points[1].y,(secondary.top+secondary.bottom)/2)};
});
const desktopPreviews='output/previews/site-ui/desktop',mobilePreviews='output/previews/site-ui/mobile';
await Promise.all([mkdir(desktopPreviews,{recursive:true}),mkdir(mobilePreviews,{recursive:true}),mkdir('output/reports',{recursive:true})]);
let downloadPath;
try{
 const mobileBootRoutes=[
  {hash:'#genotype=4,2,0,9,0,0',view:'spiral',surface:'builder',visible:'.side',destination:'builder'},
  {hash:'#spiral?genotype=4,2,0,9,0,0',view:'spiral',surface:'spiral',visible:'#universe',destination:'spiral'},
  {hash:'#collection',view:'forest',surface:'builder',visible:'#forest-view',destination:null,title:'The forest starts with a friend.'},
  {hash:'#wishlist',view:'wishlist',surface:'builder',visible:'#wishlist-view',destination:'wishlist'},
  {hash:'#history',view:'history',surface:'builder',visible:'#history-view',destination:'history'},
  {hash:'#about',view:'about',surface:'builder',visible:'#about-view',destination:'about'}
 ];
 for(const route of mobileBootRoutes){
  const bootPage=await browser.newPage();await bootPage.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await bootPage.evaluateOnNewDocument(()=>{window.__mobileBootShifts=[];window.__mobileBootShiftSources=[];new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){window.__mobileBootShifts.push(entry.value);window.__mobileBootShiftSources.push({value:entry.value,sources:entry.sources.map(source=>({node:source.node?.id||source.node?.className||source.node?.tagName,previous:source.previousRect,current:source.currentRect}))});}}).observe({type:'layout-shift',buffered:true});});
  await bootPage.setRequestInterception(true);let releaseBundle;
  const pendingBundle=new Promise(resolve=>{releaseBundle=resolve;});
  bootPage.on('request',request=>request.url().endsWith('/mycelium.bundle.js')
   ?releaseBundle(request)
   :request.url().endsWith('/chain-config.json')
   ?request.respond({status:200,contentType:'application/json',body:JSON.stringify(browserConfig)})
   :request.url()==='https://magicforest.land/api/progress'
   ?request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({got:9000,goal:100000})})
   :request.url().includes('api.coingecko.com')
   ?request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})})
   :request.url().startsWith('https://www.youtube-nocookie.com/')
   ?request.respond({status:204,contentType:'text/plain',body:''})
   :request.continue());
  await bootPage.goto(base+route.hash,{waitUntil:'domcontentloaded'});const bundleRequest=await pendingBundle;
  const initial=await bootPage.evaluate(({view,surface,visible,destination,title})=>{const header=document.querySelector('.header').getBoundingClientRect(),layout=document.querySelector('.layout').getBoundingClientRect(),nav=document.querySelector('.mobile-bottom-nav').getBoundingClientRect(),panel=document.querySelector(visible),active=destination?document.querySelector(`[data-mobile-destination="${destination}"]`).getAttribute('aria-current'):null;return {view:document.body.dataset.view,surface:document.body.dataset.mobileSurface,booting:document.body.hasAttribute('data-booting'),panelVisible:!panel.hidden&&getComputedStyle(panel).display!=='none'&&panel.getBoundingClientRect().height>0,active,title:title?panel.querySelector('h2')?.textContent:null,shell:[header.top,header.bottom,layout.top,layout.bottom,nav.top,nav.bottom].map(Math.round)};},route);
  assert.deepEqual(initial,{view:route.view,surface:route.surface,booting:true,panelVisible:true,active:route.destination?'page':null,title:route.title||null,shell:[0,64,64,778,778,844]},`The ${route.destination||route.view} route must own the first mobile frame`);
  await bundleRequest.continue();await bootPage.waitForFunction(()=>document.body.dataset.ready==='true');await bootPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const settled=await bootPage.evaluate(()=>({booting:document.body.hasAttribute('data-booting'),cls:window.__mobileBootShifts.reduce((sum,value)=>sum+value,0),sources:window.__mobileBootShiftSources,shell:[...document.querySelectorAll('.header,.layout,.mobile-bottom-nav')].flatMap(node=>{const rect=node.getBoundingClientRect();return [Math.round(rect.top),Math.round(rect.bottom)];})}));
  assert.deepEqual(settled.shell,[0,64,64,778,778,844]);assert.equal(settled.booting,false);assert.ok(settled.cls<.001,`The ${route.destination||route.view} route shifted while loading: ${JSON.stringify(settled)}`);await bootPage.close();
 }
 checks.push('Every mobile destination owns its first frame and settles with zero layout shift while the application bundle loads.');
 await page.setViewport({width:1440,height:1000});await page.goto(base);await ready();
 assert.deepEqual(await page.evaluate(()=>({fallbackHidden:document.querySelector('#preview').hidden,canvasPainted:document.querySelector('#previewCanvas').classList.contains('painted')})),{fallbackHidden:false,canvasPainted:false},'The authored preview fallback must remain visible until the live canvas is painted');
 assert.equal(await page.title(),'mycelium Friends');
 assert.deepEqual(await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily.includes('Avenir Next'),brand:getComputedStyle(document.querySelector('.brand-name')).fontFamily.includes('Avenir Next'),label:getComputedStyle(document.querySelector('.brand-small')).fontFamily.includes('Avenir Next'),code:getComputedStyle(document.querySelector('.contract-proof code')).fontFamily.includes('ui-monospace')})),{body:true,brand:true,label:true,code:true});
 assert.deepEqual(await page.$eval('.footer-brand',node=>({text:node.textContent,transform:getComputedStyle(node).textTransform})),{text:'mycelium Friends',transform:'none'});
 assert.equal(await page.$eval('.protocol-market-card',node=>node.classList.contains('is-feedback-active')),false,'The market exchange must not animate while About is hidden');
 assert.equal(await page.$$eval('.market-transfer,.market-response',nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),true);
 await page.waitForFunction(()=>!document.querySelector('#footerExchangeRate').hidden);
 assert.equal(await page.$eval('#footerExchangeRate',node=>node.textContent),'1 ETH ≈ $2,500 · €2,300');
 assert.deepEqual(await page.$$eval('.footer-links > :not([hidden])',nodes=>nodes.map(node=>node.textContent)),['MAGIC FOREST','X / TWITTER','INSTAGRAM','YOUTUBE','CONTRACT · MYFRIENDS LOCAL','EVM.NOW','GITHUB','API']);
 assert.match(await page.$eval('#footerContract',node=>node.href),/^https:\/\/explorer\.test\/address\/0x1111/);
 assert.deepEqual(await page.$$eval('.footer-links a[href^="https://github.com/"],.footer-links a[href^="https://api.mycelium."]',nodes=>nodes.map(node=>({text:node.textContent,href:node.href,target:node.target,rel:node.rel}))),[
  {text:'GITHUB',href:'https://github.com/MagicForestLand/mycelium/',target:'_blank',rel:'noopener noreferrer'},
  {text:'API',href:'https://api.mycelium.magicforest.land/',target:'_blank',rel:'noopener noreferrer'}
 ]);
 assert.equal(await page.$$eval('#forestEthEurRefresh,#retryChain',nodes=>nodes.every(node=>node.textContent.trim()===''&&node.querySelector('use')?.getAttribute('href')==='#icon-refresh')),true);
 assert.equal(await page.$eval('#forestEthEurRefresh',node=>getComputedStyle(node).borderRadius==='0px'),true);
 assert.equal(await page.$eval('#retryChain',node=>getComputedStyle(node).borderRadius==='50%'),true);
 checks.push('Footer exposes verified project links, the active network contract and the already-loaded USD/EUR rate without another quote request.');
 const preparedGenotype=(await genotype()).split(',').map(Number);
 await page.evaluate(({deployment,genotype,identity})=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{ready:true,busy:false,walletChecking:false,account:'0x2222222222222222222222222222222222222222',deployment,preparedMints:[{genotype,status:'READY TO MINT'}],snapshot:{records:[],total:0,cap:10000,price:'100000000000000',publicOpen:true,salePhase:2,blockNumber:1,blockHash:identity}}})),{deployment:browserConfig.deployments[0],genotype:preparedGenotype,identity});
 assert.equal(await page.title(),'mycelium Friends · 0.0001 ETH');
 assert.equal(await page.$eval('#previewOwnership',node=>!node.hidden&&node.classList.contains('is-prepared')&&node.title==='Preparation paid · ready to mint'&&Boolean(node.querySelector('svg'))),true);
 assert.equal(await page.$eval('#toggleWishlist',node=>node.hidden),true);
 await page.evaluate(({deployment,identity})=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{ready:true,busy:false,walletChecking:false,account:'0x2222222222222222222222222222222222222222',deployment,preparedMints:[],snapshot:{records:[],total:0,cap:10000,price:'100000000000000',publicOpen:true,salePhase:2,blockNumber:1,blockHash:identity}}})),{deployment:browserConfig.deployments[0],identity});
 assert.equal(await page.$eval('#previewOwnership',node=>node.hidden),true);
 checks.push('A gas-backed preparation replaces the wishlist heart with a compact prepared-mint status icon in Preview.');
 await page.evaluate(()=>{localStorage.removeItem('myfriends:looks:v1');localStorage.removeItem('myfriends:wishlist:v1');localStorage.removeItem('myfriends:wishlist:v2');localStorage.removeItem('myfriends:grid-size:v1');});await page.goto(base+'#genotype=4,2,0,9,0,0');await page.reload();await ready();
 const first=await genotype();await page.waitForFunction(value=>document.querySelector('#favicon').dataset.genotype===value,{},first);
 const firstFavicon=await faviconState();assert.deepEqual({type:firstFavicon.type,genotype:firstFavicon.genotype,size:firstFavicon.size,cornersTransparent:firstFavicon.cornersTransparent},{type:'image/png',genotype:first,size:[128,128],cornersTransparent:true});assert.ok(firstFavicon.visible>0,'The selected mushroom favicon must contain visible artwork');
 await page.click('#previewRandomize');const second=await genotype();await page.waitForFunction(value=>document.querySelector('#favicon').dataset.genotype===value,{},second);const secondFavicon=await faviconState();assert.notEqual(secondFavicon.signature,firstFavicon.signature,'A new selected mushroom must replace the favicon artwork');assert.equal(secondFavicon.cornersTransparent,true,'The dynamic favicon must stay transparent');
 await page.click('#previewRandomize');const third=await genotype();
 await page.click('#previousShuffle');assert.equal(await genotype(),second);await page.click('#previousShuffle');assert.equal(await genotype(),first);
 await page.click('#previewRandomize');const fourth=await genotype();assert.equal(await page.$$eval('#shufflePosition',nodes=>nodes.length),0);
 await page.click('#previousShuffle');assert.equal(await genotype(),third);await page.click('#nextShuffle');assert.equal(await genotype(),fourth);
 assert.equal(await page.$$eval('.preview-first > .preview-random,.preview-first > .preview-history',nodes=>nodes.every(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;})),true);
 await page.keyboard.press('ArrowLeft');assert.equal(await genotype(),third);await page.keyboard.press('ArrowRight');assert.equal(await genotype(),fourth);
 const wheelWasCancelled=await page.$eval('.preview-first',node=>!node.dispatchEvent(new WheelEvent('wheel',{deltaX:-80,deltaY:0,bubbles:true,cancelable:true})));
 assert.equal(wheelWasCancelled,true);assert.equal(await genotype(),third);await new Promise(resolve=>setTimeout(resolve,220));
 await page.$eval('.preview-first',node=>node.dispatchEvent(new WheelEvent('wheel',{deltaX:80,deltaY:0,bubbles:true,cancelable:true})));assert.equal(await genotype(),fourth);
 await page.reload();await ready();assert.equal(await genotype(),fourth);assert.equal(await page.$$eval('#shufflePosition',nodes=>nodes.length),0);
 await page.goto(base);await ready();assert.equal(await genotype(),fourth);
 checks.push('The favicon follows the selected mushroom as transparent PNG artwork; shuffle history survives reload and a fresh URL.');
 assert.equal(await page.$eval('#showSpiral',node=>node.getAttribute('aria-current')),'page');
 assert.equal(await page.$eval('#universe',node=>node.hidden),false);
 assert.equal(await page.$eval('#traitCatalog',node=>node.hidden),true);
 assert.equal(await page.$$eval('#aboutVideoFrame iframe',nodes=>nodes.length),0);
 assert.equal(await page.$$eval('#gallery canvas',nodes=>nodes.length),0,'The hidden Collection must not allocate artwork canvases');
 await page.click('.top-links [data-view="about"]');await page.waitForSelector('#aboutVideoFrame iframe');
 assert.ok((await page.$eval('#aboutVideoFrame iframe',frame=>frame.src)).startsWith('https://www.youtube-nocookie.com/embed/'));
 await page.waitForFunction(()=>document.querySelector('#forestDonationAmount').textContent==='€9,000'&&document.querySelector('#forestEthEurRate').textContent.includes('€2,300'));
 assert.deepEqual(await progressGoalAlignment(),{labelRight:true,valueRight:true,textAlign:'right'});
 assert.equal(await page.$$('.protocol-live').then(nodes=>nodes.length),0);
 assert.deepEqual(await page.$$eval('#aboutContractLink,#aboutPriceContract,#aboutRoyaltyContract',nodes=>nodes.map(node=>({hidden:node.hidden,href:node.href,icon:node.querySelector('use')?.getAttribute('href')}))),[
  {hidden:false,href:await page.$eval('#footerContract',node=>node.href),icon:'#icon-etherscan'},
  {hidden:false,href:await page.$eval('#footerContract',node=>node.href),icon:'#icon-etherscan'},
  {hidden:false,href:await page.$eval('#footerContract',node=>node.href),icon:'#icon-etherscan'}
 ]);
 assert.deepEqual(await page.$$eval('#aboutContractSecondary,#aboutPriceContractSecondary,#aboutRoyaltyContractSecondary',nodes=>nodes.map(node=>({hidden:node.hidden,href:node.href,icon:node.querySelector('use')?.getAttribute('href')}))),[
  {hidden:false,href:await page.$eval('#footerContractSecondary',node=>node.href),icon:'#icon-evm'},
  {hidden:false,href:await page.$eval('#footerContractSecondary',node=>node.href),icon:'#icon-evm'},
  {hidden:false,href:await page.$eval('#footerContractSecondary',node=>node.href),icon:'#icon-evm'}
 ]);
 assert.equal(await page.$$eval('.contract-resources a[href="https://github.com/MagicForestLand/mycelium/"]',nodes=>nodes.length===3&&nodes.every(node=>node.tagName==='A'&&node.target==='_blank'&&node.rel==='noopener noreferrer'&&node.querySelector('use')?.getAttribute('href')==='#icon-github')),true);
 assert.equal(await page.$$eval('.contract-resource.is-placeholder',nodes=>nodes.length),0);
 assert.equal(await page.$$eval('.contract-proof',nodes=>nodes.length),3);
 assert.deepEqual(await page.$$eval('.protocol-card:not(.protocol-market-card)',cards=>{
  const values=cards.map(card=>({bottom:card.getBoundingClientRect().bottom,resources:card.querySelector('.contract-resources').getBoundingClientRect().top,proof:card.querySelector('.contract-proof').getBoundingClientRect().top}));
  const aligned=key=>Math.max(...values.map(value=>value[key]))-Math.min(...values.map(value=>value[key]))<1;
 const spiral=cards.find(card=>card.classList.contains('protocol-spiral-card'));
 return {cardBottom:aligned('bottom'),resourceTop:aligned('resources'),proofTop:aligned('proof'),priceBeforeResources:Boolean(spiral.querySelector('.price-spiral-mini').compareDocumentPosition(spiral.querySelector('.contract-resources'))&Node.DOCUMENT_POSITION_FOLLOWING)};
 }),{cardBottom:true,resourceTop:true,proofTop:true,priceBeforeResources:true});
 assert.deepEqual(await page.$eval('.price-spiral-mini',node=>{const style=getComputedStyle(node),card=node.closest('.protocol-card'),rect=node.getBoundingClientRect(),heading=card.querySelector('h2'),copy=card.querySelector(':scope > p');return {contained:rect.left>card.getBoundingClientRect().left&&rect.right<card.getBoundingClientRect().right,bordered:style.borderTopWidth==='1px',rounded:Number.parseFloat(style.borderTopLeftRadius)>0,steps:node.querySelectorAll('span').length,arrows:node.querySelectorAll('i').length,afterHeading:Boolean(heading.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING),beforeCopy:Boolean(node.compareDocumentPosition(copy)&Node.DOCUMENT_POSITION_FOLLOWING)};}),{contained:true,bordered:true,rounded:true,steps:5,arrows:4,afterHeading:true,beforeCopy:true});
 await page.$eval('.about-protocol',node=>node.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:`${desktopPreviews}/about-protocol.png`});
 await page.click('.contract-proof summary');
 assert.match(await page.$eval('.contract-proof[open] code',node=>node.textContent),/CombinationAlreadyMinted/);
 assert.equal(await page.$eval('.contract-proof[open]',node=>{
  const card=node.closest('.protocol-card'),pre=node.querySelector('pre');
  return card.scrollWidth===card.clientWidth&&pre.getBoundingClientRect().right<=card.getBoundingClientRect().right&&node.querySelectorAll('[class^="code-"]').length>=5;
 }),true);
 assert.deepEqual(await page.$eval('.protocol-market-card',node=>({count:document.querySelectorAll('.protocol-market-card').length,amount:node.querySelector('.market-primary strong').textContent,power:node.querySelector('.market-power').getAttribute('aria-label'),markets:node.querySelectorAll('.market-side').length,grid:[getComputedStyle(node).gridColumnStart,getComputedStyle(node).gridColumnEnd]})),{count:1,amount:'268,435,456',power:'2 to the power of 28',markets:2,grid:['1','-1']});
 assert.match(await page.$eval('.market-primary',node=>node.textContent),/mathematical horizon, not a sellout plan/);
 assert.match(await page.$eval('.market-feedback',node=>node.textContent),/single 1\/1 artwork/);
 assert.match(await page.$eval('.market-feedback',node=>node.textContent),/10k pfp collection that starts cheap/);
 assert.match(await page.$eval('.market-feedback',node=>node.textContent),/forest and an Art Hub for a community/);
 assert.doesNotMatch(await page.$eval('.market-feedback',node=>node.textContent),/tried and lost|If it dies/);
 assert.equal(await page.$$eval('.protocol-market-card [data-about-destination="builder"]',nodes=>nodes.length),2);
 await page.$eval('.market-bridge',node=>node.scrollIntoView({block:'center'}));
 await page.waitForFunction(()=>document.querySelector('.protocol-market-card').classList.contains('is-feedback-active'));
 assert.deepEqual(await page.$$eval('.market-circuit',nodes=>nodes.map(node=>['.market-track','.market-transfer','.market-node'].map(selector=>node.querySelectorAll(selector).length))),[[2,2,2],[2,2,2]]);
 assert.deepEqual(await marketCircuitGeometry(),{vertical:false,centered:true,contact:true,aligned:true});
 assert.equal(await page.$$eval('.market-side',nodes=>nodes.every(node=>{const border=getComputedStyle(node),title=getComputedStyle(node.querySelector('h3'),'::after');return border.borderTopWidth==='1px'&&border.animationName.endsWith('-border')&&getComputedStyle(node,'::after').content==='none'&&title.content==='none';})),true,'Market reactions must use each card actual border without a fill overlay or title underline');
 assert.equal(await page.$$eval('.market-transfer,.market-response',nodes=>nodes.length===8&&nodes.every(node=>{const style=getComputedStyle(node);return style.animationName!=='none'&&style.animationIterationCount==='infinite'&&Number.parseFloat(style.animationDuration)===10;})),true,'The market exchange must repeat a slow ten-second feedback cycle');
 assert.deepEqual(await page.$eval('.market-bridge',node=>({hidden:node.getAttribute('aria-hidden'),interactive:node.querySelectorAll('a,button,[tabindex]').length,pointer:getComputedStyle(node).pointerEvents})),{hidden:'true',interactive:0,pointer:'none'});
 await page.click('#marketMotionToggle');
 assert.equal(await page.$eval('#marketMotionToggle',node=>node.getAttribute('aria-pressed')),'true');
 assert.equal(await page.$$eval('.market-transfer,.market-response,.market-side',nodes=>nodes.every(node=>getComputedStyle(node).animationPlayState==='paused')),true,'Pause must stop transfers, nodes and both receiving card borders');
 await page.click('#marketMotionToggle');
 assert.equal(await page.$eval('#marketMotionToggle',node=>node.getAttribute('aria-pressed')),'false');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 assert.equal(await page.$$eval('.market-transfer,.market-response',nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none'&&getComputedStyle(node).opacity==='0')),true,'Reduced motion must leave a readable static market circuit');
 assert.equal(await page.$$eval('.market-side',nodes=>nodes.every(node=>{const style=getComputedStyle(node);return style.animationName==='none'&&style.borderTopColor==='rgb(48, 61, 104)';})),true,'Reduced motion must keep both real card borders static');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 await page.waitForFunction(()=>document.querySelector('.protocol-market-card').classList.contains('is-feedback-active'));
 assert.deepEqual(await page.$eval('.protocol-market-card',node=>{
  const animations=node.getAnimations({subtree:true});animations.forEach(animation=>animation.pause());
  return [1100,3000,4100,5500,7100,9000].map(time=>{
   animations.forEach(animation=>animation.currentTime=time);
   return ['.market-circuit-desktop .market-transfer-out','.market-circuit-desktop .market-transfer-back','.market-secondary','.market-primary'].map(selector=>selector.startsWith('.market-circuit')?Number(getComputedStyle(node.querySelector(selector)).opacity)>.1:getComputedStyle(node.querySelector(selector)).borderTopColor!=='rgb(48, 61, 104)');
  });
 }),[[true,false,false,false],[false,false,true,false],[false,false,false,false],[false,true,false,false],[false,false,false,true],[false,false,false,false]],'The loop must alternate transfer, receiving-card response and quiet pauses');
 await page.$eval('.protocol-market-card',node=>node.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=3000;}));
 await (await page.$('.market-loop')).screenshot({path:`${desktopPreviews}/about-market-loop.png`});
 await page.$eval('.protocol-market-card',node=>node.getAnimations({subtree:true}).forEach(animation=>animation.play()));
 checks.push('The market circuit meets both panel boundaries and repeats a ten-second exchange with receiving-card responses; user pause and offscreen visibility suspend it, while reduced motion stays static.');
 assert.equal(await page.$eval('.about-footer-links',node=>getComputedStyle(node).display),'none');
 await page.click('[data-about-destination="builder"]');await page.waitForFunction(()=>!document.querySelector('#traitCatalog').hidden);
 await page.waitForFunction(()=>!document.querySelector('.protocol-market-card').classList.contains('is-feedback-active'));
 assert.equal(await page.$$eval('.market-transfer,.market-response',nodes=>nodes.every(node=>getComputedStyle(node).animationPlayState==='paused')),true,'The hidden About circuit must not keep animating');
 assert.equal(await page.$eval('#showTraits',node=>node.getAttribute('aria-current')),'page');
 await page.click('.top-links [data-view="about"]');await page.waitForSelector('#aboutVideoFrame iframe');
 await page.click('[data-about-destination="collection"]');await page.waitForFunction(()=>!document.querySelector('#forest-view').hidden);
 assert.equal(await page.$eval('#showCollectionMode',node=>node.getAttribute('aria-pressed')),'true');
 await page.click('#showSpiral');await page.waitForFunction(()=>document.querySelectorAll('#aboutVideoFrame iframe').length===0);
 checks.push('About omits the redundant live strip, links price and royalty rules to the deployed contract, and routes desktop CTAs to Traits and Collection.');
 checks.push('The external film exists only while About is open; hidden galleries allocate no artwork canvases.');
 await page.click('#showTraits');
 assert.equal(await page.$eval('#showTraits',node=>node.getAttribute('aria-current')),'page');
 assert.equal(await page.$eval('#universe',node=>node.hidden),true);
 assert.equal(await page.$eval('#traitCatalog',node=>node.hidden),false);
 assert.equal(await page.$eval('#spiral-view',node=>node.classList.contains('catalog-open')),true);
 await page.waitForFunction(()=>document.querySelectorAll('#catalogGrid canvas[data-painted]').length>0);
 const initialCatalog=await page.evaluate(()=>({count:document.querySelectorAll('#catalogGrid .catalog-trait').length,images:document.querySelectorAll('#catalogGrid img').length,canvases:document.querySelectorAll('#catalogGrid canvas').length,painted:document.querySelectorAll('#catalogGrid canvas[data-painted]').length}));
 assert.equal(initialCatalog.count,await page.$eval('#select-cap',node=>node.options.length));assert.equal(initialCatalog.images,0);assert.equal(initialCatalog.canvases,initialCatalog.count);assert.ok(initialCatalog.painted>0&&initialCatalog.painted<initialCatalog.canvases);
 await page.evaluate(()=>{const catalog=document.querySelector('#traitCatalog');catalog.scrollTop=600;});
 assert.equal(await page.evaluate(()=>{const panel=document.querySelector('.explore-panel').getBoundingClientRect(),toolbar=document.querySelector('#exploreToolbar').getBoundingClientRect(),side=document.querySelector('.side').getBoundingClientRect(),layout=document.querySelector('#spiral-view').getBoundingClientRect();return Math.abs(toolbar.left-panel.left)<2&&Math.abs(toolbar.right-panel.right)<2&&Math.abs(side.top-layout.top)<2;}),true);
 const modeControls=await page.evaluate(()=>{
  const toolbar=document.querySelector('#exploreToolbar').getBoundingClientRect();
  const tabs=document.querySelector('#catalogTabs').getBoundingClientRect();
  return {inside:tabs.left>=toolbar.left&&tabs.right<=toolbar.right&&tabs.top>=toolbar.top&&tabs.bottom<=toolbar.bottom,
    categories:document.querySelectorAll('#catalogTabs [data-category]').length,
    active:document.querySelectorAll('#catalogTabs [aria-pressed=true]').length,
    position:getComputedStyle(document.querySelector('#exploreToolbar')).position};
 });
 assert.deepEqual(modeControls,{inside:true,categories:6,active:1,position:'relative'});
 for(const key of ['stem','cap','temperament','glasses','accessory','hobby']){
  await page.click('[data-category="'+key+'"]');await page.click('#catalogGrid .catalog-trait[data-option="1"] .catalog-select');
  assert.equal(await page.$$eval('#catalogGrid .catalog-select[aria-pressed=true]',nodes=>nodes.length),1);
  assert.equal(await page.$eval('#catalogGrid .catalog-select[aria-pressed=true]',n=>n.closest('.catalog-trait').dataset.option),'1');
  const index=['stem','cap','temperament','glasses','accessory','hobby'].indexOf(key);assert.equal((await genotype()).split(',')[index],'1');
 }
 await page.click('[data-category="cap"]');
await page.waitForFunction(() => {
  const active = document.querySelector('[data-category="cap"]')?.getAttribute('aria-pressed') === 'true';
  const button = document.querySelector('#next-cap');
  if (!active || !button || button.disabled) return false;
  const rect = button.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return hit === button || button.contains(hit);
});
 await page.click('#next-cap');
 assert.equal(await page.$eval('#catalogGrid .catalog-select[aria-pressed=true]',n=>n.closest('.catalog-trait').dataset.option),'2');
 await page.$eval('#catalogGrid .catalog-trait[data-category="cap"][data-option="80"] .catalog-select',button=>button.click());
 await new Promise(resolve=>setTimeout(resolve,700));
 assert.ok(await page.$eval('#catalogGrid .catalog-trait[data-category="cap"][data-option="80"]',node=>{const root=document.querySelector('#traitCatalog').getBoundingClientRect(),card=node.getBoundingClientRect();return Math.abs((card.top+card.height/2)-(root.top+root.height/2))<8;}),'A changed trait must scroll smoothly to the catalog viewport centre');
 await page.click('.swatch:not(.active)');assert.equal(await page.$eval('#catalogTabs [aria-pressed="true"]',node=>node.dataset.category),'cap','Changing the stem colour must preserve the active trait catalog');
 const specialStemMarkers=await page.$$eval('[data-stem-marker]',nodes=>nodes.map(node=>({id:node.dataset.stemMarker,svg:node.querySelectorAll('svg').length,text:[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent.trim()).join(''),footprint:node.querySelector('svg')?.classList.contains('footprint-icon')||false})));
 assert.deepEqual(specialStemMarkers.map(marker=>marker.id),['golden-anatomy','nuclear-ember','frankenstem','cocoa-stomp','blush-stomp']);
 assert.ok(specialStemMarkers.every(marker=>marker.svg===1&&!marker.text),'Every special stem must use its own vector marker instead of a platform emoji');
 assert.deepEqual(specialStemMarkers.filter(marker=>marker.id.endsWith('stomp')).map(marker=>marker.footprint),[true,true],'Both Stomp stems must use the reviewed footprint vector');
 await page.keyboard.press('3');assert.equal(await page.$eval('#catalogTabs [aria-pressed="true"]',node=>node.dataset.category),'temperament');
 const temperamentBefore=(await genotype()).split(',')[2];await page.keyboard.press('ArrowDown');assert.notEqual((await genotype()).split(',')[2],temperamentBefore);
 await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');assert.equal(await page.$eval('#catalogTabs [aria-pressed="true"]',node=>node.dataset.category),'glasses');
 await page.keyboard.press('2');assert.equal(await page.$eval('#catalogTabs [aria-pressed="true"]',node=>node.dataset.category),'cap');
 await page.click('#showSpiral');assert.equal(await page.$eval('#universe',n=>n.hidden),false);
 assert.equal(await page.$eval('#showSpiral',node=>node.getAttribute('aria-current')),'page');
 await page.click('#showTraits');
 assert.equal(await page.$$eval('a[href*="editor.html"]',nodes=>nodes.length),0);
 const capOptionCount=await page.$eval('#select-cap',node=>node.options.length);
 assert.deepEqual(await page.evaluate(()=>({cards:document.querySelectorAll('#catalogGrid .catalog-trait').length,dropdowns:document.querySelectorAll('.select-trait').length,sentinelHidden:document.querySelector('#catalogSentinel').hidden})),{cards:capOptionCount,dropdowns:5,sentinelHidden:true});
 checks.push('Spiral and catalog links switch the current view; the catalog renders every current option while painting only visible lightweight canvases.');
 checks.push('Desktop preview history works through arrows, keyboard and horizontal trackpad gestures; the dice is the only random control.');
 checks.push('All six trait categories keep compact dropdowns, center the active catalog option, preserve the catalog while changing stem colour and support keyboard navigation.');
 checks.push('All five special stems use stable in-product SVG markers, including distinct left and right footprints.');
 checks.push('The category toolbar spans only the exploration workspace while the preview sidebar keeps its full desktop height.');
 const desktopPreviewGeometry=await page.$eval('.preview-first',node=>{const preview=node.getBoundingClientRect(),canvas=node.querySelector('#previewCanvas'),fallback=node.querySelector('#preview'),art=canvas.getBoundingClientRect();return {previewHeight:preview.height,artHeight:art.height,previewBackground:getComputedStyle(node).backgroundImage,artBackground:getComputedStyle(canvas).backgroundImage,canvasPainted:canvas.classList.contains('painted'),fallbackHidden:fallback.hidden};});
 assert.ok(desktopPreviewGeometry.previewHeight>=250&&desktopPreviewGeometry.previewHeight-desktopPreviewGeometry.artHeight>=30,`Desktop Preview must reserve vertical breathing room around the artwork: ${JSON.stringify(desktopPreviewGeometry)}`);
 assert.ok(desktopPreviewGeometry.previewBackground.startsWith('radial-gradient')&&desktopPreviewGeometry.artBackground==='none','Preview background must cover the full card instead of ending with the artwork canvas');
 assert.ok(desktopPreviewGeometry.canvasPainted&&desktopPreviewGeometry.fallbackHidden,'The live Preview canvas must replace, never overlap, the authored fallback image');
 await page.screenshot({path:`${desktopPreviews}/catalog.png`});
 assert.equal(await page.$$eval('#catalogGrid .trait-like',nodes=>nodes.length),0);
 assert.equal(await page.$eval('#toggleWishlist',node=>node.hidden),false);
 assert.equal(await page.$eval('#spiralModeToggle',node=>node.hidden),true);
 await page.click('#showSpiral');
 assert.equal(await page.$eval('#toggleWishlist',node=>node.hidden),false);
 assert.equal(await page.$eval('#previewVersion',node=>getComputedStyle(node).display),'none');
 assert.ok(await page.$eval('.preview-history',node=>node.getBoundingClientRect().width<80),'Desktop Preview history must stay a compact arrow pair');
 assert.deepEqual(await page.$$eval('.spiral-transport > *',nodes=>nodes.map(node=>node.id)),['spiralScrub','spiralPosition','spiralLatest']);
 const spiralScaleBottom=await page.$eval('.spiral-controls .view-tools',node=>node.getBoundingClientRect().bottom);
 await page.click('#toggleWishlist');assert.equal(await page.$eval('#toggleWishlist',node=>node.getAttribute('aria-pressed')),'true');
 await page.click('#showCollectionMode');await page.waitForFunction(()=>!document.querySelector('#forest-view').hidden);
 assert.equal(await page.$eval('#showCollectionMode',node=>node.getAttribute('aria-pressed')),'true');
 assert.equal(await page.$eval('#spiral-view',node=>node.hidden),false);
 assert.deepEqual(await page.$$eval('#forest-view,#wishlist-view,#history-view',nodes=>nodes.map(node=>node.dataset.gridSize)),['medium','medium','medium']);
 assert.equal(await page.$eval('#gridScaleControls',node=>node.hidden),false);
 assert.ok(Math.abs(await page.$eval('#gridScaleControls',node=>node.getBoundingClientRect().bottom)-spiralScaleBottom)<.5);
 assert.equal(await page.$$eval('#gridScaleControls button',nodes=>nodes.length),3);
 assert.deepEqual(await page.$eval('#gridScaleControls',node=>({text:node.textContent.replace(/\s/g,''),scale:node.querySelector('output').textContent,fit:node.querySelector('#resetGridScale').textContent})),{text:'−100%+FIT',scale:'100%',fit:'FIT'});
 await page.screenshot({path:`${desktopPreviews}/collection-scale.png`});
 await page.click('#gridScaleControls [data-grid-scale="1"]');
 assert.deepEqual(await page.$$eval('#forest-view,#wishlist-view,#history-view',nodes=>nodes.map(node=>node.dataset.gridSize)),['large','large','large']);
 assert.equal(await page.$eval('#gridScaleLevel',node=>node.textContent),'125%');
 assert.equal(await page.evaluate(()=>localStorage.getItem('myfriends:grid-size:v1')),'large');
 await page.click('#showSpiralMode');await page.waitForFunction(()=>!document.querySelector('#universe').hidden);
 assert.equal(await page.$eval('#showSpiralMode',node=>node.getAttribute('aria-pressed')),'true');
 assert.equal(await page.$eval('#gridScaleControls',node=>node.hidden),true);
 assert.equal(await page.evaluate(()=>document.querySelector('#spiralModeIcon path').getAttribute('d')===document.querySelector('.brandmark path').getAttribute('d')),true);
 await page.click('.top-links [data-view="wishlist"]');await page.waitForFunction(()=>!document.querySelector('#wishlist-view').hidden);
 assert.equal(await page.$$eval('#wishlist-gallery .forest-card',nodes=>nodes.length),1);
 assert.equal(await page.$$eval('#wishlist-gallery [data-wishlist-mint]',nodes=>nodes.length),1);
 assert.equal(await page.$$eval('#wishlist-gallery .forest-label',nodes=>nodes.length),0);
 assert.equal(await page.$eval('.top-links [data-view="wishlist"]',node=>node.getAttribute('aria-current')),'page');
 assert.equal(await page.$eval('#gridScaleControls',node=>node.hidden),false);
 await page.click('#resetGridScale');
 assert.equal(await page.$eval('#gridScaleLevel',node=>node.textContent),'100%');
 await page.screenshot({path:`${desktopPreviews}/wishlist.png`});
 await page.reload();await ready();assert.equal(await page.$$eval('#wishlist-gallery .forest-card',nodes=>nodes.length),1);
 assert.deepEqual(await page.$$eval('#forest-view,#wishlist-view,#history-view',nodes=>nodes.map(node=>node.dataset.gridSize)),['medium','medium','medium']);
 await page.evaluate(()=>{for(let i=0;i<80;i++)document.querySelector('#previewRandomize').click();});
 await page.click('.top-links [data-view="history"]');await page.waitForFunction(()=>!document.querySelector('#history-view').hidden);
 assert.ok(await page.$$eval('#history-gallery .forest-card',nodes=>nodes.length)>50);
 assert.ok(await page.$$eval('#history-gallery .look-like',nodes=>nodes.length)>0);
 assert.equal(await page.$$eval('#history-gallery .forest-label strong',nodes=>nodes.length),0);
 assert.equal(await page.$$eval('#history-gallery .forest-label span',nodes=>nodes.every(node=>/^LOOK \d+$/.test(node.textContent))),true);
 assert.equal(await page.$$eval('#history-gallery .look-select',nodes=>nodes.every(node=>node.getAttribute('aria-label').startsWith(node.textContent.trim()+' · '))),true);
 assert.equal(await page.$$eval('#history-gallery img',nodes=>nodes.length),0);
 await page.waitForFunction(()=>document.querySelector('#history-gallery canvas[data-painted]'));
 await page.screenshot({path:`${desktopPreviews}/history.png`});
 const historyCanvasState=await page.evaluate(()=>({total:document.querySelectorAll('#history-gallery canvas').length,painted:document.querySelectorAll('#history-gallery canvas[data-painted]').length}));
 assert.ok(historyCanvasState.painted<historyCanvasState.total,'History must rasterize only the cards near the viewport');
 await page.$eval('#history-view',view=>{view.scrollTop=view.scrollHeight;});
 await page.waitForFunction(()=>document.querySelector('#history-gallery canvas').width===1);
 await page.$eval('#history-view',view=>{view.scrollTop=0;});
 await page.waitForFunction(()=>document.querySelector('#history-gallery canvas').width===480);
 const wishlistCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')).length);
 await page.$eval('#history-gallery .look-like:not(.active)',button=>button.click());
 await page.waitForFunction(count=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')).length===count+1,{},wishlistCount);
 assert.equal(await page.$eval('.top-links [data-view="history"]',node=>node.getAttribute('aria-current')),'page');
 assert.equal(await page.$eval('#gridScaleControls',node=>node.hidden),false);
 await page.click('#gridScaleControls [data-grid-scale="-1"]');
 await page.click('#gridScaleControls [data-grid-scale="-1"]');
 await page.click('#gridScaleControls [data-grid-scale="-1"]');
 assert.deepEqual(await page.$$eval('#forest-view,#wishlist-view,#history-view',nodes=>nodes.map(node=>node.dataset.gridSize)),['tiny','tiny','tiny']);
 assert.equal(await page.$eval('#gridScaleControls [data-grid-scale="-1"]',node=>node.disabled),true);
 assert.equal(await page.$eval('#gridScaleLevel',node=>node.textContent),'50%');
 await page.click('#resetGridScale');
 const currentBeforeClear=await genotype(),looksBeforeClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:looks:v1')).looks.length),wishlistBeforeClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')).length);
 assert.equal(await page.$eval('#clearHistory',node=>!node.hidden&&node.getBoundingClientRect().width===44&&node.getBoundingClientRect().height===44),true);
 await page.click('#clearHistory');assert.equal(await page.$eval('#clearHistory',node=>node.classList.contains('is-confirming')&&node.getAttribute('aria-label')==='Confirm clear history'),true);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:looks:v1')).looks.length),looksBeforeClear);
 await page.click('#clearHistory');assert.equal(await genotype(),currentBeforeClear);assert.deepEqual(await page.evaluate(()=>{const history=JSON.parse(localStorage.getItem('myfriends:looks:v1'));return {looks:history.looks.length,position:history.position,wishlist:JSON.parse(localStorage.getItem('myfriends:wishlist:v2')).length};}),{looks:1,position:0,wishlist:wishlistBeforeClear});assert.equal(await page.$eval('#previewVersion',node=>node.textContent),'1 / 1');assert.equal(await page.$eval('#clearHistory',node=>node.hidden),true);
 checks.push('Wishlist persists liked full combinations and exposes a direct mint action; History keeps only nearby previews rasterized and restores released artwork on return.');
 checks.push('History exposes one compact, guarded clear action that keeps the current myFriend and Wishlist intact.');
 checks.push('Collection, Wishlist and History share five persisted artwork scales with three compact steps and clear limits.');
 checks.push('The preview heart remains available for complete unminted looks in both Spiral and Traits; the on-chain collection shares the workspace.');
 await page.click('.top-links [data-view="myfriends"]');await page.waitForFunction(()=>!document.querySelector('#myfriends-view').hidden);
 assert.equal(await page.$eval('.top-links [data-view="myfriends"]',node=>node.getAttribute('aria-current')),'page');
 await page.click('#stem-1');
 assert.equal(await page.$eval('#traitCatalog',node=>node.hidden),true);
 assert.equal(await page.$eval('.top-links [data-view="myfriends"]',node=>node.getAttribute('aria-current')),'page');
 checks.push('Changing the stem colour never steals the current page or trait category.');
 assert.equal(await page.$$eval('#contextPanel #download, #contextPanel #download-json',nodes=>nodes.length),0);
 assert.equal(await page.$eval('#contextPanel',node=>node.textContent.includes('▦')),false);
 checks.push('The builder stays focused on choosing and minting: generic exports and decorative trait-title squares are absent.');
 for(const width of [1440,1024,768,390,320]){
  await page.setViewport({width,height:width<700?844:900});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await visibleOverflow(),false,'page overflow at '+width);

  await page.waitForFunction(()=>{
    const button=document.querySelector('#wallet'),dialog=document.querySelector('#mintDialog');
    if(!button||!dialog||button.disabled||dialog.hasAttribute('open'))return false;
    const rect=button.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  });

  console.log(`CHECK: wallet dialog at ${width}px`);
  const walletState=await page.$eval('#wallet',button=>{
    const r=button.getBoundingClientRect();
    const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {
      disabled:button.disabled,
      rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      topTag:top?.tagName||null,
      topId:top?.id||null,
      topClass:typeof top?.className==='string'?top.className:null
    };
  });
  console.log('WALLET STATE:',JSON.stringify(walletState));

  await page.focus('#wallet');await page.waitForFunction(()=>typeof document.querySelector('#wallet')?.onclick==='function',{timeout:10000});await page.$eval('#wallet',button=>button.onclick());
  try{
    await page.waitForSelector('#mintDialog[open]',{timeout:5000});
  }catch(error){
    const state=await page.evaluate(()=>({
      dialogOpen:document.querySelector('#mintDialog')?.open||false,
      activeId:document.activeElement?.id||null
    }));
    throw new Error(`Mint dialog did not open at ${width}px: ${JSON.stringify(state)}`,{cause:error});
  }

  const bounds=await page.evaluate(()=>{const d=document.querySelector('#mintDialog').getBoundingClientRect(),p=document.querySelector('#mintPreview').getBoundingClientRect();return {width:d.width,height:d.height,inside:p.top>=d.top&&p.bottom<=d.bottom&&p.width>0,overflow:document.querySelector('#mintDialog').scrollWidth>d.width};});
  assert.equal(bounds.inside,true);assert.equal(bounds.overflow,false);
  const walletAddress=await page.$('#walletDialogAddress');
  if(walletAddress){
   const addressLayout=await walletAddress.evaluate(node=>({singleLine:node.scrollHeight<=Math.ceil(parseFloat(getComputedStyle(node).lineHeight))+1,inside:node.scrollWidth<=node.clientWidth}));
   assert.deepEqual(addressLayout,{singleLine:true,inside:true},`Wallet address must remain on one line at ${width}px`);
  }
  if(width===1440)await page.screenshot({path:`${desktopPreviews}/wallet.png`});
  if(width===390)await page.screenshot({path:`${mobilePreviews}/wallet.png`});

  await page.click('#closeMint');
  await page.waitForFunction(()=>!document.querySelector('#mintDialog')?.hasAttribute('open'));
 }
 checks.push('320, 390, 768, 1024 and 1440px layouts have no page or dialog overflow; preview stays inside the dialog.');
 await page.setViewport({width:390,height:844});
 await page.click('[data-mobile-destination="builder"]');await page.waitForFunction(()=>document.body.dataset.mobileSurface==='builder'&&document.body.dataset.view==='spiral');
 assert.deepEqual(await page.$$eval('[data-mobile-destination]',nodes=>nodes.map(node=>node.dataset.mobileDestination)),['builder','spiral','wishlist','history','about']);
 assert.deepEqual(await page.$$eval('[data-mobile-destination="builder"],[data-mobile-destination="spiral"]',nodes=>nodes.map(node=>({label:node.querySelector('strong').textContent,svg:Boolean(node.querySelector('svg')),paths:node.querySelectorAll('path,circle').length}))),[{label:'Builder',svg:true,paths:4},{label:'Spiral',svg:true,paths:1}]);
 await page.evaluate(({deployment,identity})=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{ready:true,busy:false,walletChecking:false,account:null,deployment,walletEnabled:false,preparedMints:[],snapshot:{records:[],total:0,cap:10000,price:'0',publicOpen:false,salePhase:0,blockNumber:1,blockHash:identity}}})),{deployment:browserConfig.deployments[0],identity});
 assert.deepEqual(await page.$eval('#previewMint',node=>({text:node.textContent.trim(),disabled:node.disabled})),{text:'READ-ONLY PREVIEW',disabled:true});
 checks.push('Read-only PAUSED mode replaces the mobile primary action with one disabled and truthful preview status.');
 await page.evaluate(({deployment,identity})=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{ready:true,busy:false,walletChecking:false,account:null,deployment,walletEnabled:true,preparedMints:[],snapshot:{records:[],total:0,cap:10000,price:'12340000000000000',publicOpen:true,salePhase:2,blockNumber:1,blockHash:identity}}})),{deployment:browserConfig.deployments[0],identity});
 assert.equal(await page.title(),'mycelium Friends · 0.01234 ETH');
 assert.equal(await page.$eval('.top-links',node=>getComputedStyle(node).display),'none');
 assert.equal(await page.$$eval('#mobileCategoryTabs [role="tab"]',nodes=>nodes.length),6);
 assert.equal(await page.$$eval('#mobileCategoryTabs [aria-selected="true"]',nodes=>nodes.length),1);
 assert.equal(await page.$$eval('button.mint',nodes=>nodes.filter(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;}).length),1);
 assert.equal(await page.$eval('#previewMint',node=>node.scrollWidth<=node.clientWidth),true,'Mobile primary price must fit its button');
 assert.equal(await page.$eval('#previewNumber',node=>getComputedStyle(node).display!=='none'&&node.textContent.trim()==='PREVIEW'),true);
 assert.equal(await page.$eval('#previewRandomize',node=>getComputedStyle(node).borderRadius==='50%'&&node.querySelectorAll('.preview-die-face').length===6),true);
 assert.notEqual(await page.$eval('#previewVersion',node=>getComputedStyle(node).display),'none');
 assert.deepEqual(await page.$$eval('.preview-die-face',faces=>faces.map(face=>({value:Number(face.dataset.dieValue),pips:face.children.length,backface:getComputedStyle(face).backfaceVisibility}))),[1,2,3,4,5,6].map(value=>({value,pips:value,backface:'hidden'})));
 assert.equal(await page.$eval('.preview-die-cube',node=>getComputedStyle(node).transformStyle),'preserve-3d');
 assert.equal(await page.$$eval('.preview-die-face',faces=>{
  const geometry=faces.map(face=>({value:Number(face.dataset.dieValue),matrix:new DOMMatrix(getComputedStyle(face).transform)}));
  return geometry.every(({value,matrix})=>{
   const opposite=geometry.find(face=>face.value===7-value).matrix;
   return Math.abs(Math.hypot(matrix.m41,matrix.m42,matrix.m43)-7)<.00001&&Math.abs(matrix.m31*opposite.m31+matrix.m32*opposite.m32+matrix.m33*opposite.m33+1)<.00001;
  });
 }),true,'All six faces must sit one half-edge from the centre, with opposite numbers on opposite planes');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const reducedDieBefore=await page.$eval('#previewRandomize',node=>node.dataset.faces);
 await page.click('#previewRandomize');
 assert.notEqual(await page.$eval('#previewRandomize',node=>node.dataset.faces),reducedDieBefore);
 assert.equal(await page.$eval('.preview-die-cube',node=>node.getAnimations().length),0,'Reduced motion must select a new solid orientation without starting a roll');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 const dieBefore=await page.$eval('#previewRandomize',node=>node.dataset.faces);
 await page.evaluate(()=>{const cube=document.querySelector('.preview-die-cube'),animate=cube.animate.bind(cube);cube.animate=(frames,options)=>{const animation=animate(frames,options);animation.pause();window.__dieRoll={frames:frames.length,duration:options.duration,animation,transforms:frames.map(frame=>frame.transform),pips:[...cube.querySelectorAll('.preview-die-pip')]};cube.animate=animate;return animation;};});
 assert.equal(await page.$$eval('.shuffle-bar,#randomize',nodes=>nodes.length),0);
 assert.deepEqual(await page.$$eval('.mobile-builder-scroll,.mobile-category-tabs,.mobile-trait-rail',nodes=>nodes.map(node=>getComputedStyle(node).touchAction)),['auto','auto','auto']);
 assert.deepEqual(await page.$$eval('.mobile-builder-scroll,.mobile-category-tabs,.mobile-trait-rail',nodes=>nodes.map(node=>getComputedStyle(node).overscrollBehaviorX)),['none','none','none']);
 const versionBefore=await page.$eval('#previewVersion',node=>node.textContent.trim().split('/').map(Number)),genotypeBeforeRandom=await genotype();
 await page.click('#previewRandomize');const genotypeAfterRandom=await genotype(),versionAfterRandom=await page.$eval('#previewVersion',node=>node.textContent.trim().split('/').map(Number));
 assert.notEqual(genotypeAfterRandom,genotypeBeforeRandom);assert.deepEqual(versionAfterRandom,[versionBefore[1]+1,versionBefore[1]+1]);
 assert.deepEqual(await page.evaluate(()=>({frames:window.__dieRoll.frames,duration:window.__dieRoll.duration})),{frames:5,duration:560});
 const dieMotion=await page.evaluate(()=>{
  const {animation,transforms,pips}=window.__dieRoll,cube=document.querySelector('.preview-die-cube'),button=document.querySelector('#previewRandomize'),bounds=button.getBoundingClientRect(),samples=[];
  for(let time=0;time<560;time+=20){
   animation.currentTime=time;const matrix=new DOMMatrix(getComputedStyle(cube).transform);
   const lengths=[[matrix.m11,matrix.m12,matrix.m13],[matrix.m21,matrix.m22,matrix.m23],[matrix.m31,matrix.m32,matrix.m33]].map(axis=>Math.hypot(...axis));
   samples.push({solid:!matrix.is2D&&lengths.every(length=>Math.abs(length-1)<.00001),inside:[...cube.children].every(face=>{const rect=face.getBoundingClientRect();return [[rect.left,rect.top],[rect.right,rect.top],[rect.left,rect.bottom],[rect.right,rect.bottom]].every(([x,y])=>Math.hypot(x-(bounds.left+bounds.width/2),y-(bounds.top+bounds.height/2))<bounds.width/2-1);})});
  }
  animation.currentTime=190;
  return {samples: samples.length,rigid:samples.every(sample=>sample.solid),contained:samples.every(sample=>sample.inside),pipsUnchanged:pips.every((pip,index)=>pip===cube.querySelectorAll('.preview-die-pip')[index]),threeAxes:transforms.slice(1).every(transform=>transform.includes('rotateX(')&&transform.includes('rotateY(')&&transform.includes('rotateZ('))};
 });
 assert.deepEqual(dieMotion,{samples:28,rigid:true,contained:true,pipsUnchanged:true,threeAxes:true});
 await page.screenshot({path:`${mobilePreviews}/die-roll.png`});
 await page.evaluate(()=>window.__dieRoll.animation.finish());
 await page.waitForFunction(()=>!document.querySelector('#previewRandomize').classList.contains('is-rolling'));
 const dieAfter=await page.$eval('#previewRandomize',node=>({faces:node.dataset.faces,pips:node.querySelectorAll('.preview-die-pip').length})),dieValues=dieAfter.faces.split('-').map(Number);
 assert.notEqual(dieAfter.faces,dieBefore);assert.equal(dieAfter.pips,21);assert.equal(new Set(dieValues).size,3);assert.equal(dieValues.every(value=>value>=1&&value<=6),true);assert.equal(dieValues.every((value,index)=>dieValues.slice(index+1).every(other=>value+other!==7)),true);
 assert.equal(await page.evaluate(()=>{
  const cube=document.querySelector('.preview-die-cube'),matrix=new DOMMatrix(getComputedStyle(cube).transform),expected=new DOMMatrix(window.__dieRoll.transforms.at(-1)),actual=Array.from(matrix.toFloat64Array());
  const visible=[];for(const face of cube.children){const normal=matrix.multiply(new DOMMatrix(getComputedStyle(face).transform)).transformPoint(new DOMPoint(0,0,1,0));if(normal.z>.5)visible[normal.y<-.5?0:normal.x<0?1:2]=Number(face.dataset.dieValue);}
  return actual.every((value,index)=>Math.abs(value-expected.toFloat64Array()[index])<.00001)&&visible.join('-')===document.querySelector('#previewRandomize').dataset.faces&&window.__dieRoll.pips.every((pip,index)=>pip===cube.querySelectorAll('.preview-die-pip')[index]);
 }),true,'A completed physical roll must match its target matrix and visible faces without replacing any pip');
 const previewBox=await page.$eval('.preview-first',node=>{const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
 await swipe(previewBox,.22,.78);
 assert.equal(await genotype(),genotypeBeforeRandom);assert.deepEqual(await page.$eval('#previewVersion',node=>node.textContent.trim().split('/').map(Number)),[versionAfterRandom[1]-1,versionAfterRandom[1]]);
 await swipe(previewBox,.78,.22);
 assert.equal(await genotype(),genotypeAfterRandom);assert.deepEqual(await page.$eval('#previewVersion',node=>node.textContent.trim().split('/').map(Number)),versionAfterRandom);
 assert.equal(await page.$eval('#toggleWishlist',node=>node.getAttribute('aria-pressed')),'false','Preview swipes must not trigger a like');
 const wishlistBeforeDoubleTap=await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')||'[]').length);
 await page.$eval('#toast',node=>node.classList.remove('visible'));
 await page.touchscreen.tap(previewBox.x+previewBox.width/2,previewBox.y+previewBox.height/2);await new Promise(resolve=>setTimeout(resolve,70));await page.touchscreen.tap(previewBox.x+previewBox.width/2,previewBox.y+previewBox.height/2);
 await page.waitForFunction(()=>document.querySelector('#toggleWishlist').getAttribute('aria-pressed')==='true');
 assert.equal(await page.$eval('#previewLikeBurst',node=>node.classList.contains('is-active')),true);
 assert.equal(await page.$eval('#toast',node=>node.classList.contains('visible')),false,'The visual double-tap feedback must not be duplicated by a toast');
 await page.screenshot({path:`${mobilePreviews}/builder-double-tap.png`});
 const wishlistAfterDoubleTap=await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')||'[]').length);
 assert.equal(wishlistAfterDoubleTap,wishlistBeforeDoubleTap+1);
 await page.touchscreen.tap(previewBox.x+previewBox.width/2,previewBox.y+previewBox.height/2);await new Promise(resolve=>setTimeout(resolve,70));await page.touchscreen.tap(previewBox.x+previewBox.width/2,previewBox.y+previewBox.height/2);
 assert.equal(await page.$eval('#toggleWishlist',node=>node.getAttribute('aria-pressed')),'true','A repeated double-tap must not remove the like');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('myfriends:wishlist:v2')||'[]').length),wishlistAfterDoubleTap);
 await page.click('[data-mobile-category="cap"]');
 await page.click('#mobile-trait-cap-3');
 const mobileGenotype=(await genotype()).split(',');mobileGenotype[1]='4';let mobileGenotypeText=mobileGenotype.join(',');
 await page.evaluate(()=>{
   const rail=document.querySelector('#mobileTraitRail'),first=rail.firstElementChild;first.dataset.persistenceCheck='kept';
   rail.scrollLeft=Math.max(0,(rail.scrollWidth-rail.clientWidth)/2);
   const nativeScrollTo=rail.scrollTo.bind(rail);
   rail.scrollTo=options=>{window.__mobileTraitCenterRequest={left:options.left,behavior:options.behavior};rail.scrollTo=nativeScrollTo;return nativeScrollTo(options);};
   document.querySelector('#mobile-trait-cap-4').click();
 });
 assert.equal((await genotype()).split(',')[1],'4');
 assert.equal(await page.$eval('#mobileTraitRail',node=>node.firstElementChild.dataset.persistenceCheck),'kept','Trait choice must preserve the existing rail DOM');
 assert.equal(await page.evaluate(()=>window.__mobileTraitCenterRequest.behavior),'smooth');
 await page.waitForFunction(()=>{const rail=document.querySelector('#mobileTraitRail'),selected=rail.querySelector('[aria-selected="true"]'),root=rail.getBoundingClientRect(),item=selected.getBoundingClientRect();return Math.abs(item.left+item.width/2-root.left-root.width/2)<2;});
 await new Promise(resolve=>setTimeout(resolve,180));
 assert.ok(await page.$$eval('#mobileTraitRail canvas',nodes=>nodes.filter(node=>node.dataset.painted).length)<20,'Smooth centering must not paint every passing trait');
 const edgeCenters=await page.$eval('#mobileTraitRail',rail=>{
   const offset=button=>{const root=rail.getBoundingClientRect(),item=button.getBoundingClientRect();return item.left+item.width/2-root.left-root.width/2;};
   rail.scrollLeft=0;const first=offset(rail.firstElementChild);rail.scrollLeft=rail.scrollWidth-rail.clientWidth;const last=offset(rail.lastElementChild);return {first,last,paddingLeft:getComputedStyle(rail).paddingLeft,paddingRight:getComputedStyle(rail).paddingRight,width:rail.clientWidth};
 });
 assert.ok(Math.abs(edgeCenters.first)<2&&Math.abs(edgeCenters.last)<2,'The rail must center both edge traits: '+JSON.stringify(edgeCenters));
 assert.equal(await page.evaluate(()=>location.hash),'#genotype='+mobileGenotypeText);
 assert.equal(await page.$eval('#mobileTraitRail [aria-selected="true"]',node=>node.title),'King Crimson');
 assert.equal(await page.$$eval('#mobileTraitRail [tabindex="0"]',nodes=>nodes.length),1);
 assert.equal(await page.evaluate(()=>document.body.textContent.includes('BUILD YOUR FRIEND')||document.body.textContent.includes('Six traits. One myFriend.')),false);
 await page.$eval('#mobileTraitRail',node=>{node.scrollLeft=0;});
 await page.waitForFunction(()=>document.querySelector('#mobile-trait-cap-4 canvas')?.dataset.painted==='true');
 await page.$eval('#mobileTraitRail',node=>{node.scrollLeft=node.scrollWidth;});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await page.$eval('#mobile-trait-cap-4 canvas',node=>({painted:node.dataset.painted,width:node.width})),{painted:'true',width:96});
 await page.evaluate(({deployment})=>{
  const owner='0x3333333333333333333333333333333333333333',genotype=window.myFriendsUI.genotype(),records=Array.from({length:61},(_,index)=>({tokenId:String(index+1),genotype:[...genotype],price:String(index*100000000000000),phase:'public',step:index+1,buyer:owner,owner,transactionHash:'0x'+String(index+1).padStart(64,'0'),blockNumber:2}));
  const mobileDeployment={...deployment,id:deployment.id+'-mobile-lifecycle'};
  window.__baseMobileDeployment=deployment;
  window.__mobileSpiralState={ready:true,busy:false,walletChecking:false,account:null,deployment:mobileDeployment,walletEnabled:true,preparedMints:[],snapshot:{records,total:records.length,cap:10000,price:'6100000000000000',publicOpen:true,salePhase:2,blockNumber:2,blockHash:'0x'+'ab'.repeat(32)}};
  window.__mobileStateLock=event=>{if(event.detail!==window.__mobileSpiralState)event.stopImmediatePropagation();};
  window.__mobileConfirmed=window.myFriendsUI.confirmed;window.myFriendsUI.confirmed=()=>{};
  window.addEventListener('myfriends:state',window.__mobileStateLock,true);
  window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState}));
 },{deployment:browserConfig.deployments[0]});
 const hiddenSpiral=await page.evaluate(()=>({path:Boolean(document.querySelector('#mainSpiral').getAttribute('d')),nodes:document.querySelectorAll('#nodes [data-slot]').length,phase:document.body.dataset.spiralIntro,total:document.querySelector('#stage').dataset.totalPositions,position:document.querySelector('#spiralPosition').textContent}));
 assert.deepEqual({path:hiddenSpiral.path,nodes:hiddenSpiral.nodes,phase:hiddenSpiral.phase},{path:true,nodes:0,phase:'waiting'},'A snapshot received in Builder keeps the mobile Spiral geometry but creates no hidden canvases or fake positions');
 await page.focus('#mobile-trait-cap-4');await page.keyboard.press('ArrowRight');mobileGenotype[1]='5';mobileGenotypeText=mobileGenotype.join(',');
 assert.equal(await genotype(),mobileGenotypeText);assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-trait-cap-5');
 assert.equal(await page.$$eval('#nodes [data-slot]',nodes=>nodes.length),0,'Builder changes must not create or repaint hidden Spiral canvases');
 await page.click('[data-mobile-destination="about"]');await page.waitForFunction(()=>document.body.dataset.view==='about');
 const afterAbout=await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,nodes:document.querySelectorAll('#nodes [data-slot]').length,pending:document.querySelector('#stage').classList.contains('spiral-loading-pending'),loading:document.querySelector('#stage').classList.contains('spiral-loading')}));
 assert.deepEqual(afterAbout,{phase:'waiting',nodes:0,pending:false,loading:false},'Leaving Builder before the first Spiral visit must preserve the pending intro without leaving its thread permanently masked');
 await page.evaluate(()=>{
  window.__introReveals=[];window.__introAnimate=Element.prototype.animate;
  Element.prototype.animate=function(...args){const animation=window.__introAnimate.apply(this,args);if(this.matches?.('#nodes .node'))window.__introReveals.push({slot:Number(this.dataset.slot),createdAt:document.timeline.currentTime,animation});return animation;};
 });
 const immediateSpiral=await page.$eval('[data-mobile-destination="spiral"]',link=>{link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));const path=document.querySelector('#mainSpiral').getAttribute('d');return {view:document.body.dataset.view,surface:document.body.dataset.mobileSurface,visible:getComputedStyle(document.querySelector('#universe')).display!=='none',path:Boolean(path),nodes:document.querySelectorAll('#nodes [data-slot]').length,phase:document.body.dataset.spiralIntro};});
 assert.deepEqual(immediateSpiral,{view:'spiral',surface:'spiral',visible:true,path:true,nodes:0,phase:'waiting'},'A mobile Spiral tap reveals its shell in the input event without synchronously painting hidden canvases');
 await page.waitForFunction(()=>document.body.dataset.mobileSurface==='spiral');
 await page.waitForFunction(()=>document.querySelector('#stage').classList.contains('spiral-loading'));
 const mobileThreadMotion=await page.evaluate(()=>{
  const stage=document.querySelector('#stage'),main=document.querySelector('#mainSpiral'),back=document.querySelector('#backSpiral');
  return {mainName:getComputedStyle(main).animationName,mainDuration:getComputedStyle(main).animationDuration,mainFilter:getComputedStyle(main).filter,backName:getComputedStyle(back).animationName,backOpacity:getComputedStyle(back).opacity,start:Number.parseFloat(stage.style.getPropertyValue('--spiral-loading-start')),end:Number.parseFloat(stage.style.getPropertyValue('--spiral-loading-end')),normalized:main.hasAttribute('pathLength')};
 });
 assert.equal(mobileThreadMotion.mainName,'spiral-loading-draw','The mobile Spiral keeps the same single-stroke drawing motion as desktop');
 assert.equal(mobileThreadMotion.mainDuration,'3.2s','The mobile brush must not rush through the visible Spiral');
 assert.equal(mobileThreadMotion.mainFilter,'none','The moving mobile brush must not ask WebKit to repaint a drop shadow on every frame');
 assert.equal(mobileThreadMotion.backName,'none','The wide glow line must not be animated in blocks behind the mobile brush');
 assert.equal(mobileThreadMotion.backOpacity,'0','The wide glow line stays hidden until the clean mobile stroke is complete');
 assert.equal(mobileThreadMotion.normalized,false,'The mobile brush uses its real pixel length instead of WebKit pathLength normalization');
 assert.ok(mobileThreadMotion.start>mobileThreadMotion.end&&mobileThreadMotion.end>0,'The mobile brush duration is fitted in real path pixels to the visible path instead of its offscreen safety tail');
 await page.waitForFunction(()=>document.body.dataset.spiralIntro==='waiting'&&document.querySelector('#nodes .node:not(.empty) canvas')?.dataset.genotype,{timeout:3000}).catch(async error=>{console.error('Thread preparation state:',await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,loading:document.querySelector('#stage').className,nodes:document.querySelectorAll('#nodes .node').length,pending:document.querySelectorAll('#nodes .spiral-art-pending').length,painted:document.querySelectorAll('#nodes canvas.painted').length,snapshot:Boolean(window.__mobileSpiralState?.snapshot)})));throw error;});
 const threadPreparation=await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,pending:document.querySelectorAll('#nodes .spiral-art-pending').length,ready:document.querySelectorAll('#nodes .spiral-art-ready').length,painted:document.querySelectorAll('#nodes canvas.painted').length,reveals:window.__introReveals.length}));
 assert.ok(threadPreparation.phase==='waiting'&&threadPreparation.pending>0&&threadPreparation.ready===0&&threadPreparation.painted>0&&threadPreparation.reveals===0,'The drawing thread quietly prepares mobile canvases while every mushroom remains hidden');
 await page.evaluate(()=>{window.__mobileSpiralStateTimer=setInterval(()=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState})),100);});
 await page.waitForFunction(()=>document.body.dataset.spiralIntro!=='waiting',{timeout:6000});
 await page.waitForFunction(()=>document.body.dataset.spiralIntro==='minted'&&document.querySelector('#nodes .node:not(.empty) canvas')?.dataset.genotype,{timeout:6000});
 await page.waitForFunction(()=>new Set(window.__introReveals.map(item=>item.slot)).size>=4,{timeout:3000});
 const introRevealCadence=await page.evaluate(()=>{const seen=new Set(),unique=window.__introReveals.filter(item=>!seen.has(item.slot)&&seen.add(item.slot)).slice(0,4);const result=unique.map(item=>{const timing=item.animation.effect.getTiming();return {slot:item.slot,createdAt:item.createdAt,delay:timing.delay,duration:timing.duration,frames:item.animation.effect.getKeyframes()};});Element.prototype.animate=window.__introAnimate;return result;});
 assert.deepEqual(introRevealCadence.map(item=>item.slot),[1,2,3,4],'The first mobile mushrooms reveal from the Spiral centre in exact numbered order');
 assert.ok(introRevealCadence.every((item,index)=>index===0||item.createdAt-introRevealCadence[index-1].createdAt>=100),'The first mobile mushroom fades are created on distinct presentation frames without pair-like timing');
 assert.ok(introRevealCadence.every(item=>item.delay===0),'Mobile reveal animations start when created instead of asking Safari to schedule a future WAAPI batch');
 assert.ok(introRevealCadence.every(item=>item.duration===400&&item.frames[0].opacity==='0'&&item.frames[0].visibility==='visible'&&item.frames[0].transform.includes('scale(0.84)')),'Each mobile mushroom uses the same compositor-only soft growth from transparent to visible, without a discrete visibility cut');
 const introBeforeReset=await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,nodes:document.querySelectorAll('#nodes [data-slot]').length,painted:document.querySelectorAll('#nodes canvas.painted').length}));
 assert.ok(introBeforeReset.phase==='minted'&&introBeforeReset.nodes>0&&introBeforeReset.painted>0,'The visible mobile Spiral starts its ordered mushroom reveal only after the thread and snapshot are ready');
 await page.evaluate(()=>{
  clearInterval(window.__mobileSpiralStateTimer);delete window.__mobileSpiralStateTimer;
  window.__mobileDispatchEvent=window.dispatchEvent;
  window.dispatchEvent=function(event){return event?.type==='myfriends:state'?true:window.__mobileDispatchEvent.call(this,event);};
 });
 await page.click('#reset');
 const settledAfterReset=await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,nodes:document.querySelectorAll('#nodes [data-slot]').length}));
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.deepEqual(await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,nodes:document.querySelectorAll('#nodes [data-slot]').length})),settledAfterReset,'Reset cancels the mobile intro RAF instead of letting it overwrite the stable scene later');
 assert.equal(settledAfterReset.phase,'done');
 await page.evaluate(()=>{window.dispatchEvent=window.__mobileDispatchEvent;delete window.__mobileDispatchEvent;});
 // Keep this synthetic interaction fixture authoritative while the real reader
 // independently reports the intentionally unavailable local RPC.
 await page.evaluate(()=>{window.__mobileSpiralState={...window.__mobileSpiralState,deployment:{...window.__mobileSpiralState.deployment,id:window.__mobileSpiralState.deployment.id+'-interaction'}};window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState}));window.__mobileSpiralStateTimer=setInterval(()=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState})),100);});
 await page.waitForFunction(()=>{const node=document.querySelector('#nodes .node:not(.empty).spiral-art-ready');return document.body.dataset.spiralIntro==='minted'&&node&&getComputedStyle(node).visibility==='visible';}).catch(async error=>{console.error('Mobile interaction intro state:',await page.evaluate(()=>({phase:document.body.dataset.spiralIntro,view:document.body.dataset.view,surface:document.body.dataset.mobileSurface,hidden:document.hidden,stage:document.querySelector('#stage').className,nodes:document.querySelectorAll('#nodes .node').length,painted:document.querySelectorAll('#nodes canvas.painted').length,hash:location.hash})));throw error;});
 const interruptedIntro=await page.evaluate(async()=>{const node=document.querySelector('#nodes .node:not(.empty).spiral-art-ready'),slot=node.dataset.slot,position=document.querySelector('#spiralScrub').value;node.focus();await new Promise(resolve=>requestAnimationFrame(resolve));return {connected:node.isConnected,slotStillPresent:Boolean(document.querySelector(`#nodes [data-slot="${slot}"]`)),position,settledPosition:document.querySelector('#spiralScrub').value,phase:document.body.dataset.spiralIntro};});
 assert.deepEqual(interruptedIntro,{connected:true,slotStillPresent:true,position:interruptedIntro.position,settledPosition:interruptedIntro.position,phase:'done'},'Interrupting the mushroom reveal must settle at its current position so the tapped or focused mushroom does not disappear');
 await page.evaluate(()=>{clearInterval(window.__mobileSpiralStateTimer);delete window.__mobileSpiralStateTimer;window.removeEventListener('myfriends:state',window.__mobileStateLock,true);delete window.__mobileStateLock;});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{...window.__mobileSpiralState,snapshot:null}})));
 await page.waitForFunction(()=>document.querySelectorAll('#nodes [data-slot]').length===0);
 assert.equal(await page.$eval('#spiralPosition',node=>node.textContent),'0 / 0','A temporarily unavailable snapshot must show no fabricated NEXT mushroom or future positions');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState})));
 await page.waitForFunction(()=>document.querySelectorAll('#nodes [data-slot]').length>0);
 assert.equal(await page.evaluate(()=>location.hash),'#spiral?genotype='+mobileGenotypeText);
 assert.equal(await page.$eval('[data-mobile-destination="spiral"]',node=>node.getAttribute('aria-current')),'page');
 assert.notEqual(await page.$eval('#universe',node=>getComputedStyle(node).display),'none');
 await page.evaluate(()=>{const snapshot={...window.__mobileSpiralState.snapshot,records:[],total:0,blockNumber:3,blockHash:'0x'+'cd'.repeat(32)};window.__mobileSpiralState={...window.__mobileSpiralState,deployment:window.__baseMobileDeployment,snapshot};window.dispatchEvent(new CustomEvent('myfriends:state',{detail:window.__mobileSpiralState}));document.querySelector('#reset').click();});
 await page.evaluate(()=>{
  for(let index=0;index<12;index++)window.__mobileConfirmed({tokenId:String(900+index),genotype:[index%29,index%64,index%20,index%19,index%2,index%23],owner:'0x4444444444444444444444444444444444444444',price:'0',transactionHash:'0x'+String(index+1).padStart(64,'0'),phase:'public'});
  window.myFriendsUI.confirmed=window.__mobileConfirmed;delete window.__mobileConfirmed;
 });
 assert.equal(await page.$eval('#universe',node=>getComputedStyle(node).touchAction),'none');
 assert.deepEqual(await page.$$eval('.spiral-controls button',nodes=>nodes.filter(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&rect.width>0&&rect.height>0;}).map(node=>node.id)),['reset']);
 assert.equal(await page.$eval('#reset',node=>Boolean(node.querySelector('svg[data-icon="fit-view"]'))&&node.getBoundingClientRect().width>=44),true);
 const gestureState=await page.evaluate(async()=>{
  const universe=document.querySelector('#universe'),emit=(type,id,x,y)=>universe.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  emit('pointerdown',31,320,300);emit('pointermove',31,80,300);await frame();emit('pointerup',31,80,300);await frame();
  const dragged=Number(document.querySelector('#spiralScrub').value);
  emit('pointerdown',41,120,320);emit('pointerdown',42,220,320);emit('pointermove',42,300,320);await frame();emit('pointerup',42,300,320);emit('pointerup',41,120,320);await frame();
  return {dragged,zoom:document.querySelector('#zoomLevel').textContent};
 });
 assert.ok(gestureState.dragged>0,'A one-finger drag must move through the mobile Spiral');
 assert.ok(Number.parseInt(gestureState.zoom)>100,'A two-finger pinch must zoom the mobile Spiral');
 await page.click('#reset');
 assert.deepEqual(await page.evaluate(()=>({zoom:document.querySelector('#zoomLevel').textContent,position:Number(document.querySelector('#spiralScrub').value)})),{zoom:'100%',position:0});
 await page.screenshot({path:`${mobilePreviews}/spiral.png`});
 assert.equal(await page.$$eval('.living-star',nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').length<=40),true);
 assert.equal(await page.$eval('.living-star',node=>getComputedStyle(node).animationName.includes('starFloat')),false);
 await page.goBack();await page.waitForFunction(()=>document.body.dataset.view==='about');
 await page.goBack();await page.waitForFunction(()=>document.body.dataset.mobileSurface==='builder'&&document.body.dataset.view==='spiral');
 assert.equal(await genotype(),mobileGenotypeText);
 assert.equal(await page.$eval('[data-mobile-destination="builder"]',node=>node.getAttribute('aria-current')),'page');
 for(const [width,height] of [[320,700],[360,800],[375,635],[375,812],[390,844],[430,932],[768,1024],[844,390]]){
  await page.setViewport({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const mobile=await page.evaluate(async()=>{
   const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
   const nav=document.querySelector('.mobile-bottom-nav'),navRect=nav.getBoundingClientRect(),artNode=document.querySelector('.preview-first'),scroller=document.querySelector('.mobile-builder-scroll');
   scroller.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(resolve));
   const art=artNode.getBoundingClientRect(),scrollRect=scroller.getBoundingClientRect(),railRect=document.querySelector('#mobileTraitRail').getBoundingClientRect(),selected=document.querySelector('#mobileTraitRail [aria-selected="true"]').getBoundingClientRect();
   const primaryBefore=document.querySelector('#previewMint').getBoundingClientRect(),initialPrimaryVisibility=Math.max(0,Math.min(primaryBefore.bottom,scrollRect.bottom)-Math.max(primaryBefore.top,scrollRect.top))/primaryBefore.height;
   const targets=[...document.querySelectorAll('.preview-random,.mobile-category-tabs button,.mobile-bottom-nav a,.builder-actions button')].filter(visible).map(node=>{const rect=node.getBoundingClientRect();return {label:node.id||node.dataset.mobileCategory||node.dataset.mobileDestination,width:rect.width,height:rect.height};});
   scroller.scrollTop=scroller.scrollHeight;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const artAfter=artNode.getBoundingClientRect(),primary=document.querySelector('#previewMint').getBoundingClientRect();
  return {overflow:document.documentElement.scrollWidth>innerWidth,navFixed:getComputedStyle(nav).position==='fixed',navBottom:Math.abs(navRect.bottom-innerHeight)<1,controlsMeetNav:Math.abs(scrollRect.bottom-navRect.top)<1,initialPrimaryVisibility,targets,previewFixed:Math.abs(art.top-artAfter.top)<1&&Math.abs(art.bottom-artAfter.bottom)<1,controlsScrollable:['auto','scroll'].includes(getComputedStyle(scroller).overflowY),pageLocked:getComputedStyle(document.body).position==='fixed'&&getComputedStyle(document.body).overflowY==='hidden'&&getComputedStyle(document.documentElement).overflowY==='hidden',selectedVisible:selected.top>=scrollRect.top&&selected.bottom<=scrollRect.bottom,selectedCentered:Math.abs(selected.left+selected.width/2-railRect.left-railRect.width/2)<2,primaryAfterScroll:primary.top>=scrollRect.top&&primary.bottom<=scrollRect.bottom,actionsAfterTraits:Boolean(document.querySelector('#mobileTraitRail').compareDocumentPosition(document.querySelector('.builder-actions'))&Node.DOCUMENT_POSITION_FOLLOWING),visibleMints:[...document.querySelectorAll('button.mint')].filter(visible).length};
  });
  assert.equal(mobile.overflow,false,`mobile overflow at ${width}x${height}`);assert.equal(mobile.navFixed,true);assert.equal(mobile.navBottom,true);assert.equal(mobile.previewFixed,true,`preview must remain fixed while Builder controls scroll at ${width}x${height}`);assert.equal(mobile.controlsScrollable,true);assert.equal(mobile.pageLocked,true);assert.equal(mobile.selectedVisible,true,`selected trait must be visible at ${width}x${height}`);assert.equal(mobile.selectedCentered,true,`selected trait must remain horizontally centered at ${width}x${height}`);assert.equal(mobile.primaryAfterScroll,true,`primary action must be reachable below traits at ${width}x${height}`);assert.equal(mobile.actionsAfterTraits,true);assert.equal(mobile.visibleMints,1);
  if(height>520)assert.equal(mobile.controlsMeetNav,true,`Builder controls must meet the bottom navigation without a dead gap at ${width}x${height}`);
  if(width===375&&height===635)assert.ok(mobile.initialPrimaryVisibility>=.9,`iPhone 11 Pro Safari viewport should show almost all of the mint action, got ${mobile.initialPrimaryVisibility}`);
  assert.equal(mobile.targets.every(target=>target.width>=44&&target.height>=44),true,`undersized mobile target at ${width}x${height}: ${JSON.stringify(mobile.targets)}`);
 }
 await page.setViewport({width:320,height:700});
 await page.click('[data-mobile-destination="about"]');await page.waitForFunction(()=>document.body.dataset.view==='about'&&!document.querySelector('#about-view').hidden);
 assert.equal(await page.$eval('[data-mobile-destination="about"]',node=>node.getAttribute('aria-current')),'page');
 assert.deepEqual(await page.$$eval('[data-mobile-destination="history"],[data-mobile-destination="about"]',nodes=>nodes.map(node=>node.querySelector('svg')?.dataset.icon)),['history','about']);
 assert.equal(await page.$eval('[data-mobile-destination="about"] svg',node=>node.querySelectorAll('circle').length===1&&node.querySelectorAll('path').length===1),true);
 assert.deepEqual(await page.$eval('.protocol-spiral-card',card=>{const copy=card.querySelector(':scope > p').getBoundingClientRect(),steps=card.querySelector('.price-spiral-mini').getBoundingClientRect();return {copyBeforeSteps:copy.bottom<=steps.top,copyOrder:getComputedStyle(card.querySelector(':scope > p')).order,stepsOrder:getComputedStyle(card.querySelector('.price-spiral-mini')).order};}),{copyBeforeSteps:true,copyOrder:'1',stepsOrder:'2'});
 assert.deepEqual(await page.$$eval('.about-mobile-primary-links a',nodes=>nodes.map(node=>({label:node.textContent.trim(),icon:node.querySelector('use')?.getAttribute('href'),href:node.getAttribute('href'),hidden:node.hidden}))),[
  {label:'OPENSEA',icon:'#icon-opensea',href:null,hidden:true},
  {label:'TWITTER',icon:'#icon-twitter',href:'https://twitter.com/MagicForestLand',hidden:false},
  {label:'GITHUB',icon:'#icon-github',href:'https://github.com/MagicForestLand/mycelium/',hidden:false}
 ]);
 assert.deepEqual(await page.$$eval('.about-footer-links',nodes=>nodes.map(node=>getComputedStyle(node).display)),['block','block']);
 assert.equal(await page.$eval('.about-mobile-primary-links',node=>node.previousElementSibling?.id),'about-title');
 assert.equal(await page.$eval('.about-mobile-primary-links a:not([hidden]) .about-icon',node=>node.getBoundingClientRect().width),32);
 await page.$eval('#about-view',node=>node.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:`${mobilePreviews}/about-shortcuts.png`});
 assert.equal(await page.$eval('#aboutFooterContract',node=>node.href),await page.$eval('#footerContract',node=>node.href));
 assert.equal(await page.$eval('#aboutFooterContractSecondary',node=>node.href),await page.$eval('#footerContractSecondary',node=>node.href));
 assert.deepEqual(await page.$eval('#aboutFooterSourcify',node=>({hidden:node.hidden,href:node.getAttribute('href')})),{hidden:true,href:null});
 const aboutMobileBounds=await page.evaluate(()=>{
  const progress=document.querySelector('#forestProgress').getBoundingClientRect(),goal=document.querySelector('.forest-progress-goal strong').getBoundingClientRect(),track=document.querySelector('.forest-progress-track').getBoundingClientRect(),donations=document.querySelector('.forest-progress-marker.is-donations').getBoundingClientRect();
  return {pageOverflow:document.documentElement.scrollWidth>innerWidth,progressInside:progress.left>=0&&progress.right<=innerWidth,progressHeight:progress.height,goalInside:goal.left>=progress.left&&goal.right<=progress.right,donationClearance:track.top-donations.bottom,socialDisplay:getComputedStyle(document.querySelector('.about-mobile-primary-links')).display};
 });
 assert.equal(aboutMobileBounds.pageOverflow,false);
 assert.equal(aboutMobileBounds.progressInside,true);
 assert.equal(aboutMobileBounds.goalInside,true);
 assert.ok(aboutMobileBounds.progressHeight<=180,`mobile progress card should stay compact, got ${aboutMobileBounds.progressHeight}px`);
 assert.ok(aboutMobileBounds.donationClearance>=8,`direct-donations label must clear the progress bar, got ${aboutMobileBounds.donationClearance}px`);
 assert.equal(aboutMobileBounds.socialDisplay,'block');
 await page.$eval('.protocol-market-card',node=>node.scrollIntoView({block:'start'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&document.querySelector('#about-view').scrollWidth===document.querySelector('#about-view').clientWidth),true);
 await page.screenshot({path:`${mobilePreviews}/about-markets.png`,fullPage:true});
 assert.deepEqual(await marketCircuitGeometry(),{vertical:true,centered:true,contact:true,aligned:true});
 assert.equal(await page.$eval('#marketMotionToggle',node=>{const rect=node.getBoundingClientRect();return rect.width===44&&rect.height===44;}),true);
 await page.$eval('.market-bridge',node=>node.scrollIntoView({block:'center'}));
 await page.waitForFunction(()=>document.querySelector('.protocol-market-card').classList.contains('is-feedback-active'));
 await page.$eval('.protocol-market-card',node=>node.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=3000;}));
 await page.screenshot({path:`${mobilePreviews}/about-market-loop.png`});
 await page.$eval('.protocol-market-card',node=>node.getAnimations({subtree:true}).forEach(animation=>animation.play()));
 assert.deepEqual(await progressGoalAlignment(),{labelRight:true,valueRight:true,textAlign:'right'});
 assert.deepEqual(await page.$eval('#forestEthEurRefresh',node=>{const rect=node.getBoundingClientRect(),text=node.previousElementSibling.getBoundingClientRect(),style=getComputedStyle(node);return {width:rect.width,height:rect.height,icon:node.querySelector('use')?.getAttribute('href'),axisAligned:Math.abs((rect.top+rect.bottom)/2-(text.top+text.bottom)/2)<1,border:style.borderTopWidth,background:style.backgroundColor};}),{width:18,height:18,icon:'#icon-refresh',axisAligned:true,border:'0px',background:'rgba(0, 0, 0, 0)'});
 await page.$eval('#forestProgress',node=>node.scrollIntoView({block:'start'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:`${mobilePreviews}/about-progress.png`,fullPage:true});
 const headingFocusState=selector=>page.$eval(selector,node=>({focused:document.activeElement===node,outline:getComputedStyle(node).outlineStyle}));
 assert.deepEqual(await headingFocusState('#about-title'),{focused:true,outline:'none'});
 const mobileShellState=selector=>page.$eval(selector,panel=>{
  const htmlStyle=getComputedStyle(document.documentElement),bodyStyle=getComputedStyle(document.body),app=document.querySelector('.app'),layout=document.querySelector('.layout'),header=document.querySelector('.header'),nav=document.querySelector('.mobile-bottom-nav');
  const panelStyle=getComputedStyle(panel),appStyle=getComputedStyle(app),layoutStyle=getComputedStyle(layout),panelRect=panel.getBoundingClientRect(),appRect=app.getBoundingClientRect(),headerRect=header.getBoundingClientRect(),navRect=nav.getBoundingClientRect();
  return {rootLocked:htmlStyle.overflowX==='hidden'&&htmlStyle.overflowY==='hidden'&&bodyStyle.position==='fixed'&&bodyStyle.overflowX==='hidden'&&bodyStyle.overflowY==='hidden',shellClipped:appStyle.overflowX==='hidden'&&appStyle.overflowY==='hidden'&&layoutStyle.overflowX==='hidden'&&layoutStyle.overflowY==='hidden',panelScroller:panelStyle.overflowX==='hidden'&&panelStyle.overflowY==='auto'&&panelStyle.overscrollBehaviorX==='none'&&panelStyle.overscrollBehaviorY==='none',horizontalBounds:document.documentElement.scrollWidth===innerWidth&&panel.scrollWidth===panel.clientWidth&&Math.abs(panelRect.left)<1&&Math.abs(panelRect.right-innerWidth)<1,verticalBounds:Math.abs(appRect.top)<1&&Math.abs(appRect.bottom-navRect.top)<1&&Math.abs(headerRect.top)<1&&Math.abs(panelRect.top-headerRect.bottom)<1&&Math.abs(panelRect.bottom-appRect.bottom)<1,rootPosition:[scrollX,scrollY],scrollable:panel.scrollHeight>panel.clientHeight};
 });
 const assertMobileShell=async(selector,label)=>assert.deepEqual(await mobileShellState(selector),{rootLocked:true,shellClipped:true,panelScroller:true,horizontalBounds:true,verticalBounds:true,rootPosition:[0,0],scrollable:true},label);
 await assertMobileShell('#about-view','About must scroll inside the fixed mobile shell');
 await page.$eval('#about-view',node=>node.scrollTop=Math.min(480,node.scrollHeight-node.clientHeight));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await page.$eval('#about-view',node=>({panelMoved:node.scrollTop>0,root:[scrollX,scrollY],headerTop:Math.round(document.querySelector('.header').getBoundingClientRect().top),navBottom:Math.round(document.querySelector('.mobile-bottom-nav').getBoundingClientRect().bottom)})),{panelMoved:true,root:[0,0],headerTop:0,navBottom:700});
 await page.click('[data-mobile-destination="wishlist"]');await page.waitForFunction(()=>document.body.dataset.view==='wishlist');
 await assertMobileShell('#wishlist-view','Wishlist must scroll inside the fixed mobile shell');
 assert.deepEqual(await headingFocusState('#wishlist-title'),{focused:true,outline:'none'});
 await page.click('[data-mobile-destination="history"]');await page.waitForFunction(()=>document.body.dataset.view==='history');
 await assertMobileShell('#history-view','History must scroll inside the fixed mobile shell');
 assert.deepEqual(await headingFocusState('#history-title'),{focused:true,outline:'none'});
 await page.click('[data-mobile-destination="about"]');await page.waitForFunction(()=>document.body.dataset.view==='about');
 assert.deepEqual(await headingFocusState('#about-title'),{focused:true,outline:'none'});
 await page.$eval('#about-view',node=>node.scrollTop=node.scrollHeight);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:`${mobilePreviews}/about.png`,fullPage:true});
 await page.click('[data-about-destination="collection"]');await page.waitForFunction(()=>document.body.dataset.view==='forest'&&!document.querySelector('#forest-view').hidden);
 await assertMobileShell('#forest-view','Collection must scroll inside the fixed mobile shell');
 await page.click('[data-mobile-destination="about"]');await page.waitForFunction(()=>document.body.dataset.view==='about');
 await page.click('[data-about-destination="builder"]');await page.waitForFunction(()=>document.body.dataset.mobileSurface==='builder'&&document.body.dataset.view==='spiral');
 assert.equal(await page.$eval('#traitCatalog',node=>node.hidden),true);
 assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#mobileSpiralIcon path')?.getAttribute('d')===document.querySelector('.brandmark path')?.getAttribute('d'))),true);
 await page.evaluate(()=>window.myFriendsUI.notify('Saved without covering the controls.'));
 const toastMobile=await page.$eval('#toast',node=>{const rect=node.getBoundingClientRect();return {pointerEvents:getComputedStyle(node).pointerEvents,top:Math.round(rect.top),width:Math.round(rect.width),bottom:Math.round(rect.bottom)};});
 assert.equal(toastMobile.pointerEvents,'none');assert.ok(toastMobile.top>=64&&toastMobile.bottom<180&&toastMobile.width<=260,JSON.stringify(toastMobile));
 await page.$eval('#toast',node=>node.classList.remove('visible'));
 await page.click('[data-mobile-destination="builder"]');await page.waitForFunction(()=>document.body.dataset.mobileSurface==='builder'&&document.body.dataset.view==='spiral');
 await page.setViewport({width:375,height:635});await page.$eval('.mobile-builder-scroll',node=>node.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:`${mobilePreviews}/builder.png`,fullPage:true});
 checks.push('Mobile Builder keeps Preview fixed while its controls meet the bottom navigation without a dead gap, including the reduced 375×635 Safari visual viewport.');
 checks.push('The preview dice creates a new version; swipe right returns to the past and swipe left advances through the same numbered Shuffle history.');
 checks.push('A mobile Preview double-tap saves the look with a heart burst, never removes it, and remains distinct from horizontal history swipes.');
 checks.push('The circular isometric dice replaces redundant Shuffle controls on both layouts; mobile keeps the compact version counter while desktop exposes history arrows.');
 checks.push('The preview die rotates six permanent 3D faces as one rigid solid; pips stay attached, all sampled frames fit its circular button, and the final matrix exposes the expected isometric face values.');
 checks.push('Six 44px trait categories drive one horizontal value rail while preserving genotype URLs, Spiral history and browser Back.');
 checks.push('Trait selection preserves the rail DOM and painted thumbnails while smoothly centering the active value without painting passing traits.');
 checks.push('Mobile Spiral opens in the tap event, supports one-finger travel and pinch zoom, and shows one reset icon while preserving its living star field.');
 checks.push('Mobile About keeps fundraising values inside 320px, adds three small OpenSea, Twitter and GitHub shortcuts below its title, and preserves both existing footer link groups.');
 checks.push('About links the Spiral builder and secondary market, separates 1/1 and 10k-collection FOMO, and frames the visible 2^28 horizon as an honest community experiment.');
 checks.push('Fundraising totals and GOAL share the right content edge, while the exchange-rate refresh stays compact and aligned to the text axis.');
 checks.push('Programmatically focused About, Wishlist and History headings retain accessibility focus without painting a stale blue box around editorial text.');
 checks.push('Mobile About, Collection, Wishlist and History scroll inside one viewport-locked shell without horizontal page travel or root overscroll.');
 checks.push('Mobile notifications are compact, non-intercepting and stay above the artwork controls.');
 checks.push('The five-destination bottom navigation is fixed above the safe area, exposes About instead of duplicating the wallet collection, and replaces the desktop link strip on compact screens.');
 await page.evaluate(()=>{for(let i=0;i<32;i++)window.myFriendsUI.fresh();});
 const mobileGalleryState=async gallery=>page.evaluate(selector=>{const controls=document.querySelector('#gridScaleControls'),grid=document.querySelector(selector),columns=getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);return {scaleVisible:getComputedStyle(controls).display!=='none'&&controls.getBoundingClientRect().width>0,columns:columns.length};},gallery);
 await page.evaluate(()=>window.myFriendsUI.forest());await page.waitForFunction(()=>!document.querySelector('#forest-view').hidden);
 assert.deepEqual(await mobileGalleryState('#gallery'),{scaleVisible:false,columns:2});
 assert.equal(await page.$$eval('#gallery .collection-card',cards=>cards.length>0&&cards.every(card=>{const labels=[...card.querySelectorAll('.collection-card-meta dt')].map(node=>node.textContent);return labels.join('|')==='OWNER|MINT PRICE'&&!card.textContent.includes('LISTING')&&!card.textContent.includes('MINTER');})),true);
 assert.equal(await page.$eval('#forest-view',node=>node.textContent.includes('Live listings are not stored in the NFT contract.')),false);
 if(!await page.$eval('#privacyNotice',node=>node.hidden))await page.click('#privacyDismiss');
 await page.screenshot({path:`${mobilePreviews}/collection.png`});
 await page.click('[data-mobile-destination="wishlist"]');await page.waitForFunction(()=>!document.querySelector('#wishlist-view').hidden);
 assert.deepEqual(await mobileGalleryState('#wishlist-gallery'),{scaleVisible:false,columns:2});
 await page.click('[data-mobile-destination="history"]');await page.waitForFunction(()=>!document.querySelector('#history-view').hidden);
 assert.deepEqual(await mobileGalleryState('#history-gallery'),{scaleVisible:false,columns:2});
 assert.equal(await page.$$eval('#history-gallery .history-card',nodes=>nodes.length),24);
 await page.waitForFunction(()=>document.querySelector('#history-gallery canvas[data-painted]'));
 assert.equal(await page.$$eval('#history-gallery canvas',nodes=>nodes.every(node=>node.dataset.resolution==='320')),true);
 assert.equal(await page.$$eval('#history-gallery canvas',nodes=>nodes.filter(node=>node.dataset.painted).length<nodes.length),true,'Mobile History must paint only the viewport working set');
 assert.equal(await page.$eval('#moreHistory',node=>node.hidden),false);
 await page.click('#moreHistory');assert.equal(await page.$$eval('#history-gallery .history-card',nodes=>nodes.length)>24,true);
 await page.click('[data-mobile-destination="builder"]');await page.waitForFunction(()=>document.body.dataset.mobileSurface==='builder'&&document.body.dataset.view==='spiral');
 checks.push('Collection keeps only owner and mint price on narrow cards; Collection, Wishlist and History retain a stable two-column mobile grid without desktop artwork-scale controls.');
 checks.push('History renders saved looks in 24-card batches with a smaller viewport-lazy mobile canvas working set.');
 // Exercise actual browser rasterisation and verify the downloaded files, not only button labels.
 downloadPath=await mkdtemp(path.join(os.tmpdir(),'mycelium-mint-downloads-'));
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
 await page.evaluate(async()=>{for(const format of ['svg','png','jpeg'])await window.myFriendsUI.download(window.myFriendsUI.genotype(),format,'ux-check');});
 for(let i=0;i<100;i++){try{await readFile(downloadPath+'/myFriend-ux-check.jpg');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const png=await readFile(downloadPath+'/myFriend-ux-check.png'),jpeg=await readFile(downloadPath+'/myFriend-ux-check.jpg'),svg=await readFile(downloadPath+'/myFriend-ux-check.svg','utf8');
 assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1600);assert.equal(png.readUInt32BE(20),1600);
 assert.equal(jpeg.readUInt16BE(0),0xffd8);assert.match(svg,/<svg/);
 checks.push('SVG, 1600×1600 PNG and JPEG download successfully through browser image rendering.');
 // Direct wallet restoration must also work when the site has WalletConnect configured.
 await page.evaluateOnNewDocument(()=>{
  window.ethereum={on(){},removeListener(){},async request({method}){
   if(method==='eth_requestAccounts')sessionStorage.setItem('ux-wallet-connected','yes');
   if(method==='eth_accounts'||method==='eth_requestAccounts')return sessionStorage.getItem('ux-wallet-connected')?['0x3333333333333333333333333333333333333333']:[];
   if(method==='eth_chainId')return '0x7a69';throw Error('Unexpected wallet request: '+method);
  }};
 });
 await page.reload();await ready();await page.focus('#wallet');await page.waitForFunction(()=>typeof document.querySelector('#wallet')?.onclick==='function',{timeout:10000});await page.$eval('#wallet',button=>button.onclick());await page.waitForSelector('#mintBody .chain-action');await page.click('#mintBody .chain-action');
 await page.waitForFunction(()=>document.querySelector('#wallet').dataset.state==='connected');
 await page.evaluate(()=>localStorage.removeItem('myfriends:wallet'));
 await page.reload();await ready();await page.waitForFunction(()=>document.querySelector('#wallet').dataset.state==='connected');
 await page.evaluate(()=>window.myFriendsUI.confirmed({tokenId:'777',genotype:[4,2,0,9,0,0],owner:'0x3333333333333333333333333333333333333333',price:'0',transactionHash:'0x'+'77'.repeat(32),phase:'public'}));
 await page.focus('#wallet');await page.waitForFunction(()=>typeof document.querySelector('#wallet')?.onclick==='function',{timeout:10000});await page.$eval('#wallet',button=>button.onclick());
 await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your wallet');
 assert.equal(await page.$eval('#mintEyebrow',node=>node.textContent),'YOUR CONNECTED WALLET');
 assert.equal(await page.$eval('#mintArtCaption',node=>node.textContent),'Your wallet. Your myFriends.');
 assert.equal(await page.$eval('#walletDialogAddress',node=>node.textContent),'0x3333333333333333333333333333333333333333');
 assert.deepEqual(await page.$eval('#walletDialogAddress',node=>({singleLine:node.scrollHeight<=Math.ceil(parseFloat(getComputedStyle(node).lineHeight))+1,inside:node.scrollWidth<=node.clientWidth})),{singleLine:true,inside:true});
 assert.deepEqual(await page.$$eval('#mintBody .chain-action',nodes=>nodes.map(node=>node.textContent)),['VIEW MY FRIENDS','CONNECT ANOTHER WALLET','DISCONNECT WALLET']);
 assert.equal(await page.$$eval('.wallet-friend-mini',nodes=>nodes.length),1);
 assert.equal(await page.$eval('.wallet-friends-label',node=>node.textContent),'1 MYFRIEND IN THIS WALLET');
 assert.equal(await page.$eval('.wallet-friend-mini canvas',node=>getComputedStyle(node).width),'92px');
 assert.equal(await page.$eval('#mintDialog .mint-art',node=>getComputedStyle(node).display),'none');
 await page.screenshot({path:`${mobilePreviews}/wallet.png`});
 await page.click('#closeMint');
 checks.push('An already-authorized wallet reconnects after reload; its compact mobile wallet menu shows owned myFriends before wallet change and disconnect actions.');
 assert.deepEqual(errors,[]);
 await writeFile('output/reports/mint-ux.json',JSON.stringify({checks,errors},null,2)+'\n');console.log(checks.map(c=>'PASS: '+c).join('\n'));
}catch(error){try{await page.screenshot({path:path.join(os.tmpdir(),'mint-ux-failure.png')});}catch(screenshotError){console.error('Could not capture mint UX failure screenshot:',screenshotError);}throw error;}
finally{
 const closeTimer=setTimeout(()=>browser.process()?.kill('SIGKILL'),3000);
 try{await page.close().catch(()=>{});await browser.close().catch(()=>{});}finally{
  if(browserProcess?.exitCode===null&&browserProcess?.signalCode===null)browserProcess.kill('SIGKILL');
  clearTimeout(closeTimer);for(const stream of browserProcess?.stdio||[])stream?.destroy();if(downloadPath)await rm(downloadPath,{recursive:true,force:true});
  if(siteServer?.exitCode===null){
   siteServer.kill('SIGTERM');
   await Promise.race([new Promise(resolve=>siteServer.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
   if(siteServer.exitCode===null)siteServer.kill('SIGKILL');
  }
 }
}
