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
  page.on('request',r=>r.url().includes('/assets/web3/')?r.respond({status:200,contentType:'application/javascript',body:'export {};'}):r.url().includes('api.coingecko.com')?r.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})}):!r.url().startsWith(base)?r.abort():r.continue());
  await page.setViewport({width:1440,height:1000});
  await page.goto(base);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  assert.equal(await page.$eval('#stage',stage=>stage.classList.contains('spiral-loading')),true,'The empty spiral animates while collection state is loading');
  assert.notEqual(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationName),'none');
  assert.ok(await page.$eval('#mainSpiral',path=>Number.parseFloat(getComputedStyle(path).strokeDashoffset)>0),'The completed path must remain masked while the artist stroke is still drawing');
  assert.equal(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationIterationCount),'1','Loading thread draws only once');
  assert.equal(await page.$eval('#mainSpiral',path=>getComputedStyle(path).animationDuration),'3.2s','The empty thread should have time to draw visibly');
  const seed=async (count,ready=true)=>page.evaluate(({count,ready})=>{
    const records=Array.from({length:count},(_,i)=>({tokenId:String(i+1),genotype:[i%8,i%20,0,i%10,0,0],price:'100000000000000',phase:'public',step:i+1,owner:'0x1111111111111111111111111111111111111111',transactionHash:'0x'+i,blockNumber:1}));
    window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{ready,busy:false,walletChecking:false,deployment:{id:'spiral-fixture'},snapshot:{records,total:count,cap:10000,price:'100000000000000',publicOpen:true,salePhase:2,blockNumber:count}}}));
  },{count,ready});
  const introStarted=Date.now();await seed(20,false);
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
  assert.ok(Date.now()-threadFinished<400,'The latest mushroom should leave the centre as soon as the thread reaches the viewport edge');
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
  assert.match(mintButton.text,/MINT MYFRIEND · 0\.00010 ETH ≈ \$0\.25/,'The compact sidebar mint button includes the approximate USD price after chain readiness recovers');
  assert.equal(mintButton.overflow,false,'The mint price and USD estimate must fit without the decorative arrow');
  assert.equal(mintButton.sameStyle,true,'The USD estimate uses the same typography as the rest of the mint button');

  await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await seed(0,false);
  await page.waitForFunction(()=>!document.querySelector('#stage').classList.contains('spiral-loading'));
  const emptyThreadFinished=Date.now();
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='current'&&document.querySelector('#nodes [data-slot="1"].coming.intro-current'));
  assert.ok(Date.now()-emptyThreadFinished<400,'An empty collection must hand the completed thread directly to the NEXT mint');

  await seed(80);
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
