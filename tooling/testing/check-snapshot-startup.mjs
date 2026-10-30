import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const base=process.env.SITE_URL||'http://127.0.0.1:4173/';
let server,browser;
try{
  try{await fetch(base,{signal:AbortSignal.timeout(750)});}
  catch{
    server=spawn(process.execPath,['tooling/dev/serve.mjs'],{stdio:'ignore'});
    for(let i=0;i<50;i++){
      try{await fetch(base,{signal:AbortSignal.timeout(500)});break;}
      catch{if(i===49)throw Error('Local site did not start');await new Promise(resolve=>setTimeout(resolve,100));}
    }
  }
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),started=Date.now();
  await page.setViewport({width:1440,height:1000});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.spiralIntro==='minted'&&document.querySelector('#nodes .node:not(.empty)'),{timeout:5000});
  const result=await page.evaluate(()=>({
    intro:document.body.dataset.spiralIntro,
    mint:document.querySelector('#mint')?.textContent.trim(),
    wallet:document.querySelector('#wallet')?.textContent.trim(),
    positions:Number(document.querySelector('#spiralScrub')?.max||0),
    visibleMinted:document.querySelectorAll('#nodes .node:not(.empty)').length
  }));
  const elapsed=Date.now()-started;
  assert.ok(elapsed<4500,`First live snapshot mushroom took ${elapsed}ms`);
  assert.ok(result.positions>=21,'Live snapshot did not populate the minted collection');
  assert.doesNotMatch(result.mint,/CONNECTING/,'Mint price remained blocked on background RPC');
  assert.notEqual(result.wallet,'CHECKING WALLET','Wallet restoration remained blocked on background RPC');
  console.log(`PASS: the first live snapshot mushroom appeared in ${elapsed}ms; the calm sequence continued across ${result.positions} positions.`);
}finally{
  await browser?.close();server?.kill('SIGTERM');
}
