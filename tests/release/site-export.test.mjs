import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfigFromRecords,exportSite} from '../../tooling/build/export-site.mjs';
import {catalogFingerprint} from '../../tooling/lib/deployment-plan.mjs';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hash=value=>'0x'+value.repeat(64);
const address='0x1111111111111111111111111111111111111111';
const record={version:1,kind:'MYCELIUM_VERIFIED_DEPLOYMENT',releaseStatus:'CURRENT_RELEASE',network:'mainnet',chainId:1,
  sourceCommit:'a'.repeat(40),releaseDigest:'b'.repeat(64),deploymentBlock:123,deploymentHash:hash('c'),
  collection:{address,runtimeHash:hash('d'),catalogHash:catalogFingerprint().sha256},
  protocol:{mint:'commit-reveal-v1',saleLifecycle:'phased-v1'}};
const site={version:1,kind:'MYCELIUM_PUBLIC_SITE_CONFIG',mode:'wallet',projectId:'e'.repeat(32),walletMetadata:{name:'mycelium Friends',description:'myFriends by Magic Forest',url:'https://mycelium.magicforest.land/',icons:['https://mycelium.magicforest.land/output/branding/avatar.svg']},
  deployment:{id:'mycelium-friends-mainnet',label:'Mycelium Friends',networkName:'Ethereum',rpcUrl:'https://rpc.example',snapshotUrl:'https://cache.example/snapshot',mintEvidenceUrl:'https://cache.example/mint-events',explorers:{etherscan:'https://etherscan.io',evmNow:'https://evm.now'}}};
const readOnlySite={version:1,kind:'MYCELIUM_PUBLIC_SITE_CONFIG',mode:'read-only',deployment:site.deployment};

test('About names the operating entities without asserting unrecorded ownership',async()=>{
  const [html,readme]=await Promise.all([
    readFile(new URL('../../apps/web/index.html',import.meta.url),'utf8'),
    readFile(new URL('../../README.md',import.meta.url),'utf8')
  ]);
  assert.match(html,/<strong>Magic Forest Friends LLC<\/strong> is the designated operator for primary sales of <a[^>]+>mycelium Friends<\/a>/);
  assert.match(html,/Legal name<\/dt><dd>Magic Forest Friends LLC<\/dd>/);
  assert.match(html,/Jurisdiction<\/dt><dd>Wyoming, United States<\/dd>/);
  assert.match(html,/State file number<\/dt><dd>2026-002117174<\/dd>/);
  assert.match(html,/Registered office<\/dt><dd>30 N Gould St, Suite N, Sheridan, WY 82801, USA<\/dd>/);
  assert.match(html,/Net proceeds<\/dt><dd>Designated for Magic Forest Association · Spain<\/dd>/);
  assert.doesNotMatch(html,/Pending publication/);
  assert.doesNotMatch(html,/wholly owned/i);
  assert.doesNotMatch(readme,/wholly owned/i);
  for(const fact of ['Magic Forest Friends LLC','2026-002117174']){
    assert.ok(html.includes(fact),`About is missing issued entity fact: ${fact}`);
    assert.ok(readme.includes(fact),`README is missing issued entity fact: ${fact}`);
  }
});

test('About keeps an explicit inventory for exact and not-yet-public resources',async()=>{
  const html=await readFile(new URL('../../apps/web/index.html',import.meta.url),'utf8');
  for(const href of ['https://magicforest.land/','https://magicforest.land/donate','https://magicforest.land/transparency','https://twitter.com/MagicForestLand','https://www.instagram.com/magicforest.land/','https://www.youtube.com/watch?v=_owe-Pgs2Ek'])assert.ok(html.includes(`href="${href}"`),`Missing external resource: ${href}`);
  assert.match(html,/id="aboutFooterSourcify"[^>]*hidden/);
  assert.match(html,/Portions © 2025 Reown, Inc\. All Rights Reserved/);
  assert.match(html,/href="https:\/\/mycelium\.magicforest\.land\/reown-community-license\.txt"/);
  assert.match(html,/Public source tag mycelium-friends-core-v1\.0\.0 \(commit 5b7d890…\) will link here when the repository opens/);
  assert.doesNotMatch(html,/<a[^>]+class="[^"]*footer-placeholder/);
});

test('the first-visit privacy notice stays quiet and links to plain-language detail',async()=>{
  const [html,script]=await Promise.all([
    readFile(new URL('../../apps/web/index.html',import.meta.url),'utf8'),
    readFile(new URL('../../apps/web/src/mycelium.js',import.meta.url),'utf8')
  ]);
  const notice=html.slice(html.indexOf('<aside id="privacyNotice"'),html.indexOf('<div class="toast"'));
  assert.match(notice,/Privacy, simply\./);
  assert.match(notice,/essential browser storage/);
  assert.match(notice,/Learn more/);
  assert.match(notice,/Got it/);
  assert.doesNotMatch(notice,/\b(?:IP|tax|compliance|accept|reject|cookie)\b/i);
  assert.doesNotMatch(notice,/type="checkbox"/i);
  assert.match(html,/<section id="privacy-details"[^>]*tabindex="-1">/);
  assert.match(html,/This is about our responsibilities as the seller—not your personal taxes\./);
  assert.match(html,/The network address is encrypted and hidden from ordinary administration screens\./);
  assert.match(html,/Nothing is automatically sent to tax authorities/);
  assert.match(html,/An unconfirmed mint record is removed after 90 days\. A confirmed sale record is kept for 10 years\./);
  assert.match(script,/mycelium:privacy-notice:v1/);
  assert.match(script,/localStorage\.setItem\(privacyNoticeKey,'dismissed'\)/);
});

test('README publishes canonical links and an explicit wallet-safety warning',async()=>{
  const readme=await readFile(new URL('../../README.md',import.meta.url),'utf8');
  for(const href of [
    'https://mycelium.magicforest.land/',
    'https://magicforest.land/',
    'https://github.com/MagicForestLand/mycelium',
    'https://etherscan.io/address/0x49f3A83a8EE0B1BB4334c5Fa997565926234648F#code',
    'https://sourcify.dev/server/v2/contract/1/0x49f3A83a8EE0B1BB4334c5Fa997565926234648F'
  ])assert.ok(readme.includes(`](${href})`),`README is missing canonical link: ${href}`);
  assert.match(readme,/never contact you\s+first by direct message/i);
  assert.match(readme,/never ask for your seed phrase, recovery\s+phrase, private key/i);
});

test('Render applies the HTML cache policy to the exported public root path',async()=>{
  const render=await readFile(new URL('../../infra/render/render.yaml',import.meta.url),'utf8');
  const staging=render.slice(render.indexOf('name: mycelium-mainnet-staging'),render.indexOf('name: mycelium-wallet-rc'));
  const walletRC=render.slice(render.indexOf('name: mycelium-wallet-rc'),render.indexOf('name: mycelium-friends\n'));
  const production=render.slice(render.indexOf('name: mycelium-friends\n'));
  assert.match(staging,/branch: feat\/read-only-mainnet-staging/);
  assert.match(staging,/buildCommand: .*mainnet-staging-site\.json/);
  assert.match(staging,/autoDeployTrigger: off/);
  assert.doesNotMatch(staging,/\n\s+domains:/);
  assert.match(staging,/name: X-Robots-Tag\n\s+value: noindex, nofollow, noarchive/);
  assert.match(staging,/name: Content-Security-Policy\n\s+value: .*frame-ancestors 'none'.*ethereum-rpc\.publicnode\.com/);
  assert.match(staging,/- path: \/\n\s+name: Cache-Control\n\s+value: no-cache/);
  assert.match(walletRC,/branch: feat\/read-only-mainnet-staging/);
  assert.match(walletRC,/buildCommand: .*mainnet-site\.json/);
  assert.match(walletRC,/autoDeployTrigger: off/);
  assert.doesNotMatch(walletRC,/\n\s+domains:/);
  assert.match(walletRC,/name: X-Robots-Tag\n\s+value: noindex, nofollow, noarchive/);
  assert.match(walletRC,/name: Content-Security-Policy\n\s+value: .*frame-ancestors 'none'.*ethereum-rpc\.publicnode\.com/);
  assert.match(walletRC,/- path: \/\n\s+name: Cache-Control\n\s+value: no-cache/);
  assert.match(production,/branch: main/);
  assert.match(production,/buildCommand: .*mainnet-site\.json/);
  assert.match(production,/autoDeployTrigger: off/);
  assert.match(production,/domains:\n\s+- mycelium\.magicforest\.land/);
  assert.match(render,/^\s+- path: \/index\.html$/m);
  assert.doesNotMatch(render,/^\s+- path: \/frontend\/index\.html$/m);
});

test('wallet export resolves AppKit onto the reviewed patched Zod runtime',async()=>{
  const packageJSON=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../../package-lock.json',import.meta.url),'utf8'));
  assert.equal(packageJSON.overrides.zod,'4.6.7');
  const zodNodes=Object.entries(lock.packages).filter(([name])=>name.endsWith('node_modules/zod'));
  assert.deepEqual(zodNodes.map(([name])=>name),['node_modules/zod']);
  const version=zodNodes[0][1].version.split('.').map(Number);
  assert.ok(version[0]>4||version[0]===4&&(version[1]>6||version[1]===6&&version[2]>=6));
  assert.equal(lock.packages['node_modules/@reown/appkit-wallet/node_modules/zod'],undefined);
});

test('production runtime config is derived from one current mainnet evidence record',()=>{
  const config=runtimeConfigFromRecords(record,site);
  assert.equal(config.mode,'wallet');
  assert.equal(config.activeDeployment,site.deployment.id);
  assert.equal(config.deployments.length,1);
  assert.equal(config.deployments[0].chainId,1);
  assert.equal(config.deployments[0].address,address);
  assert.equal(config.deployments[0].catalogHash,catalogFingerprint().sha256);
  assert.equal(config.deployments[0].snapshotUrl,site.deployment.snapshotUrl);
  assert.equal(config.deployments[0].mintEvidenceUrl,site.deployment.mintEvidenceUrl);
  assert.deepEqual(config.deployments[0].explorers,site.deployment.explorers);
});

test('read-only runtime config is explicit and contains no wallet settings',()=>{
  const config=runtimeConfigFromRecords(record,readOnlySite);
  assert.equal(config.mode,'read-only');
  assert.equal(Object.hasOwn(config,'projectId'),false);
  assert.equal(Object.hasOwn(config,'walletMetadata'),false);
  for(const walletSettings of [{projectId:''},{projectId:'e'.repeat(32)},{walletMetadata:site.walletMetadata}]){
    assert.throws(()=>runtimeConfigFromRecords(record,{...readOnlySite,...walletSettings}),/omit wallet settings/);
  }
});

test('production runtime config rejects historical, testnet and placeholder inputs',()=>{
  for(const changed of [{releaseStatus:'HISTORICAL_PRE_RELEASE'},{network:'sepolia'},{chainId:11155111},{releaseDigest:''}])assert.throws(()=>runtimeConfigFromRecords({...record,...changed},site));
  for(const changed of [{mode:undefined},{mode:'preview'},{projectId:''},{kind:'DEV'},{walletMetadata:{...site.walletMetadata,url:'https://magicforest.land/'}},{deployment:{...site.deployment,rpcUrl:'http://localhost:8545'}},{deployment:{...site.deployment,snapshotUrl:'http://cache.example/snapshot'}},{deployment:{...site.deployment,mintEvidenceUrl:'http://cache.example/mint-events'}},{deployment:{...site.deployment,explorers:{etherscan:'https://etherscan.io',evmNow:'https://wrong.example'}}}])assert.throws(()=>runtimeConfigFromRecords(record,{...site,...changed}));
  assert.throws(()=>runtimeConfigFromRecords({...record,collection:{...record.collection,catalogHash:'0'.repeat(64)}},site),/catalog/);
});

test('production export maps frontend sources to conventional URLs and only emits public files',async()=>{
  const sourceHTML=await readFile(new URL('../../apps/web/index.html',import.meta.url),'utf8');
  const root=await mkdtemp(path.join(os.tmpdir(),'mycelium-site-export-')),previous=process.cwd();
  const files={
    'apps/web/index.html':sourceHTML,'apps/web/mycelium.bundle.js':'console.log("collection");',
    'apps/web/assets/web3/app.js':'import "./chunk-test.js"; import("./chunk-wallet.js");','apps/web/assets/web3/chunk-test.js':'export {};','apps/web/assets/web3/chunk-wallet.js':'export {};',
    'apps/web/assets/site.css':'body {}','apps/web/assets/chain.css':'#chain {}','apps/web/assets/protected-mint.css':'#mint {}',
    'node_modules/@reown/appkit/LICENSE.md':'REOWN COMMUNITY LICENSE AGREEMENT\nfixture',
    'output/branding/avatar.svg':'<svg/>','output/branding/banner.svg':'<svg/>','output/branding/preview.svg':'<svg/>',
    '.dev/web3-build.json':JSON.stringify({format:1,siteMode:'wallet',metafile:{outputs:{
      'apps/web/assets/web3/app.js':{entryPoint:'apps/web/src/chain-ui.js',imports:[{path:'apps/web/assets/web3/chunk-test.js',kind:'import-statement'},{path:'apps/web/assets/web3/chunk-wallet.js',kind:'dynamic-import'}]},
      'apps/web/assets/web3/chunk-test.js':{imports:[]},
      'apps/web/assets/web3/chunk-wallet.js':{entryPoint:'apps/web/src/wallet-appkit.js',imports:[]}
    }}}),
    'record.json':JSON.stringify(record),'site.json':JSON.stringify(site),
    'internal/private.txt':'excluded','apps/web/chain-config.json':'local-only'
  };
  for(const [file,body] of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),body);}
  try{
    process.chdir(root);await exportSite('record.json','site.json');
    const html=await readFile('output/site/index.html','utf8'),manifest=JSON.parse(await readFile('output/site/site-manifest.json','utf8'));
    assert.ok(!html.includes('/apps/web/'));
    assert.match(html,/import\('\.\/assets\/web3\/app\.[a-f0-9]{12}\.js'\)/);
    const emitted=(await readdir('output/site',{recursive:true})).filter(f=>!f.endsWith('/'));
    assert.ok(!emitted.some(f=>/^(?:frontend|internal|\.dev)(?:\/|$)/.test(f)));
    for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']|import\(['"]([^'"]+)['"]\)/g)){
      const url=match[1]||match[2];if(/^(?:[a-z]+:|#|\/\/)/i.test(url))continue;
      const file=path.posix.normalize(url);assert.ok(Object.hasOwn(manifest.files,file),`Missing public HTML dependency: ${url}`);
    }
    assert.equal(JSON.parse(await readFile('output/site/chain-config.json','utf8')).deployments[0].address,address);
    assert.ok(Object.hasOwn(manifest.files,'assets/web3/chunk-wallet.js'));
    assert.match(await readFile('output/site/reown-community-license.txt','utf8'),/REOWN COMMUNITY LICENSE AGREEMENT/);
    assert.ok(Object.hasOwn(manifest.files,'reown-community-license.txt'));

    await writeFile('site.json',JSON.stringify(readOnlySite));
    await assert.rejects(exportSite('record.json','site.json'),/Build web3 assets in read-only mode/);
    await writeFile('apps/web/assets/web3/app.js','import "./chunk-test.js";');
    await writeFile('.dev/web3-build.json',JSON.stringify({format:1,siteMode:'read-only',metafile:{outputs:{
      'apps/web/assets/web3/app.js':{entryPoint:'apps/web/src/chain-ui.js',imports:[{path:'apps/web/assets/web3/chunk-test.js',kind:'import-statement'}]},
      'apps/web/assets/web3/chunk-test.js':{imports:[]}
    }}}));
    await exportSite('record.json','site.json');
    const readOnlyConfig=JSON.parse(await readFile('output/site/chain-config.json','utf8'));
    const readOnlyManifest=JSON.parse(await readFile('output/site/site-manifest.json','utf8'));
    assert.equal(readOnlyConfig.mode,'read-only');
    assert.equal(readOnlyManifest.siteMode,'read-only');
    assert.equal(Object.hasOwn(readOnlyManifest.files,'assets/web3/chunk-wallet.js'),false);
  }finally{process.chdir(previous);}
});
