import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {brotliCompress} from 'node:zlib';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer-core';

const require=createRequire(import.meta.url),axeSource=await readFile(require.resolve('axe-core/axe.min.js'),'utf8');
const root=path.resolve('output/site'),port=Number(process.env.PORT||4175),base=process.env.SITE_URL||`http://127.0.0.1:${port}/`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const compress=promisify(brotliCompress),hashed=/\.[a-f0-9]{12}\.(?:js|css)$/;
let server,browser,firefox;

const cacheControl=file=>file==='index.html'?'no-cache':['chain-config.json','site-manifest.json'].includes(file)?'no-store':hashed.test(file)?'public, max-age=31536000, immutable':'public, max-age=3600, stale-while-revalidate=86400';
const startServer=async()=>{
  await stat(path.join(root,'site-manifest.json'));
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=pathname==='/'?'index.html':pathname.replace(/^\//,'');
      const target=path.resolve(root,file);if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html'))throw Error('outside export');
      let body=await readFile(target),extension=path.extname(target);
      const headers={'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':cacheControl(file),'X-Content-Type-Options':'nosniff'};
      if(body.length>1024&&['.html','.js','.css','.svg','.json'].includes(extension)&&/\bbr\b/.test(req.headers['accept-encoding']||'')){body=await compress(body);headers['Content-Encoding']='br';headers.Vary='Accept-Encoding';}
      headers['Content-Length']=body.length;res.writeHead(200,headers);res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
};

const routes=[
  {name:'Builder',hash:'#genotype=4,2,0,9,0,0',target:'.side'},
  {name:'Spiral',hash:'#spiral?genotype=4,2,0,9,0,0',target:'#universe'},
  {name:'Collection',hash:'#collection',target:'#forest-view'},
  {name:'Wishlist',hash:'#wishlist',target:'#wishlist-view'},
  {name:'History',hash:'#history',target:'#history-view'},
  {name:'About',hash:'#about',target:'#about-view'},
  {name:'myFriends',hash:'#myfriends',target:'#myfriends-view'}
];
const budget={fcp:2500,lcp:3500,tbt:300,cls:.1,transfer:800*1024,dom:1200};
const throttleNetwork=async client=>{
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8,connectionType:'cellular4g'});
};
const observe=page=>page.evaluateOnNewDocument(()=>{
  window.__m4={lcp:0,cls:0,longTasks:[]};
  new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__m4.lcp=Math.max(window.__m4.lcp,entry.startTime);}).observe({type:'largest-contentful-paint',buffered:true});
  new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.__m4.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});
  new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__m4.longTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});
});
const intercept=async(page,origin)=>{
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const url=request.url();
    if(url.startsWith(origin))return request.continue();
    if(url==='https://magicforest.land/api/progress')return request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({got:9000,goal:100000})});
    if(url.includes('api.coingecko.com'))return request.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ethereum:{usd:2500,eur:2300,last_updated_at:Math.floor(Date.now()/1000)}})});
    if(url.startsWith('https://www.youtube-nocookie.com/'))return request.respond({status:204,contentType:'text/plain',body:''});
    return request.respond({status:503,contentType:'application/json',body:'{}'});
  });
};
const axe=async(page,name)=>{
  await page.addScriptTag({content:axeSource});
  const violations=await page.evaluate(async()=>{
    const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
    return result.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>node.target.join(' '))}));
  });
  assert.deepEqual(violations,[],`${name} axe violations: ${JSON.stringify(violations)}`);
};
const measure=page=>page.evaluate(()=>{
  const paint=performance.getEntriesByType('paint').find(entry=>entry.name==='first-contentful-paint');
  const transfer=performance.getEntriesByType('resource').reduce((sum,entry)=>sum+entry.transferSize,0)+performance.getEntriesByType('navigation').reduce((sum,entry)=>sum+entry.transferSize,0);
  return {fcp:paint?.startTime||0,lcp:window.__m4.lcp,tbt:window.__m4.longTasks.reduce((sum,duration)=>sum+Math.max(0,duration-50),0),cls:window.__m4.cls,transfer,dom:document.getElementsByTagName('*').length};
});
const overBudget=metrics=>Object.keys(budget).filter(key=>metrics[key]>budget[key]);
const rounded=metrics=>Object.fromEntries(Object.entries(metrics).map(([key,value])=>[key,Math.round(value*100)/100]));
const medianMetrics=samples=>Object.fromEntries(Object.keys(budget).map(key=>[key,[...samples].map(sample=>sample[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]]));
const confirmPerformance=async(route,origin,initial)=>{
  const samples=[initial];
  for(let attempt=1;attempt<3;attempt++){
    const context=await browser.createBrowserContext();
    try{
      const page=await context.newPage(),client=await page.createCDPSession();
      await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});await observe(page);await intercept(page,origin);await throttleNetwork(client);await client.send('Network.setCacheDisabled',{cacheDisabled:true});
      await page.goto(base+route.hash,{waitUntil:'networkidle2',timeout:30000});await page.waitForFunction(selector=>{const node=document.querySelector(selector);return document.body.dataset.ready==='true'&&node&&!node.hidden&&getComputedStyle(node).display!=='none';},{},route.target);
      await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));samples.push(await measure(page));
    }finally{await context.close();}
    const passing=samples.filter(sample=>overBudget(sample).length===0).length;
    if(passing>=2||samples.length-passing>=2)break;
  }
  const passing=samples.filter(sample=>overBudget(sample).length===0).length;
  console.warn(`WARN ${route.name} performance confirmation: ${passing}/${samples.length} cold samples passed. ${JSON.stringify(samples.map(rounded))}`);
  assert.ok(passing>=2,`${route.name} performance budgets failed in ${samples.length-passing}/${samples.length} cold samples: ${JSON.stringify(samples.map(rounded))}`);
  return medianMetrics(samples);
};

try{
  if(!process.env.SITE_URL)await startServer();
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const origin=new URL(base).origin,results=[];
  for(const route of routes){
    const page=await browser.newPage(),client=await page.createCDPSession();
    await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});await observe(page);await intercept(page,origin);await throttleNetwork(client);await client.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.goto(base+route.hash,{waitUntil:'networkidle2',timeout:30000});await page.waitForFunction(selector=>{const node=document.querySelector(selector);return document.body.dataset.ready==='true'&&node&&!node.hidden&&getComputedStyle(node).display!=='none';},{},route.target);
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));
    let metrics=await measure(page);
    if(overBudget(metrics).length)metrics=await confirmPerformance(route,origin,metrics);
    results.push({view:route.name,...rounded(metrics)});
    for(const key of Object.keys(budget))assert.ok(metrics[key]<=budget[key],`${route.name} ${key} ${metrics[key]} exceeds ${budget[key]}`);
    await axe(page,route.name);
    await client.send('Accessibility.enable');const tree=await client.send('Accessibility.getFullAXTree');
    const unnamed=tree.nodes.filter(node=>!node.ignored&&['button','link'].includes(node.role?.value)&&!node.name?.value?.trim()).map(node=>node.role.value);
    assert.deepEqual(unnamed,[],`${route.name} exposes unnamed controls in the browser accessibility tree`);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>{const node=document.activeElement,rect=node?.getBoundingClientRect();return Boolean(node&&node!==document.body&&rect&&rect.width&&rect.height&&rect.bottom>0&&rect.top<innerHeight);}),true,`${route.name} first keyboard target must be visible`);
    await page.close();
  }
  const page=await browser.newPage(),client=await page.createCDPSession();await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});await observe(page);await intercept(page,origin);await throttleNetwork(client);await client.send('Network.setCacheDisabled',{cacheDisabled:false});
  await page.goto(base+routes[0].hash,{waitUntil:'networkidle2'});await page.reload({waitUntil:'networkidle2'});const cached=await measure(page);assert.ok(cached.transfer<120*1024,`Cached Builder reload transferred ${cached.transfer} bytes`);await page.close();
  if(process.env.FIREFOX_PATH){
    firefox=await puppeteer.launch({browser:'firefox',executablePath:process.env.FIREFOX_PATH,headless:true});
    for(const route of routes){
      const firefoxPage=await firefox.newPage();await firefoxPage.setViewport({width:1440,height:1000});await intercept(firefoxPage,origin);
      await firefoxPage.goto(base+route.hash,{waitUntil:'networkidle2',timeout:30000});await firefoxPage.waitForFunction(selector=>{const node=document.querySelector(selector);return document.body.dataset.ready==='true'&&node&&!node.hidden&&getComputedStyle(node).display!=='none';},{},route.target);
      assert.equal(await firefoxPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${route.name} overflows the Firefox viewport`);await firefoxPage.close();
    }
    console.log(`PASS Firefox desktop compatibility smoke across ${routes.length} views.`);
  }
  console.log(`PASS web quality: axe WCAG 2 A/AA, browser accessibility trees, keyboard entry and mobile performance budgets across ${routes.length} views; cached Builder reload ${Math.round(cached.transfer/1024)} KiB.`);
  console.log(JSON.stringify({budget,results,cachedReload:{transfer:cached.transfer}},null,2));
}finally{await firefox?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
