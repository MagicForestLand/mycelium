// Full current application + real production collection in a disposable local EVM.
// No real wallet, RPC endpoint, site config or live chain state is used.
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {createInterface} from 'node:readline/promises'
import path from 'node:path'
import {siteSourcePath} from '../lib/site-paths.mjs'
import ganache from 'ganache'
import puppeteer from 'puppeteer-core'
import {build} from 'esbuild'
import {BrowserProvider,ContractFactory,keccak256} from 'ethers'
import {compileContracts} from '../lib/compile-contracts.mjs'
import {catalogFingerprint} from '../lib/deployment-plan.mjs'
import {TRAIT_COUNTS,MAX_SUPPLY} from '../../collection/source/token-id.js'

console.log('RUN isolated allowlist browser check: compile and bundle current sources')
const {compiled} = compileContracts()
const local = ganache.provider({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'}})
const provider = new BrowserProvider(local,undefined,{cacheTimeout:-1})
provider.pollingInterval = 20
let browser,page,stage = 'setup'
const mintEvidence=[]
const manualVisual = process.env.MANUAL_VISUAL==='1'
const prompts = manualVisual?createInterface({input:process.stdin,output:process.stdout}):null
const previewRoot = 'output/previews/mint-flow'
const previewSteps = {'wallet-rejected':'01-wallet-rejected',success:'02-success',pending:'03-pending','quota-complete':'04-quota-complete','not-eligible':'05-not-eligible'}
const previewViewports = [
  {directory:'desktop',width:1440,height:1000},
  {directory:'mobile-390',width:390,height:844},
  {directory:'mobile-320',width:320,height:568}
]
const allowlistArtHeights = new Map()
const heartbeat = setInterval(() => console.log('WORKING allowlist browser: ' + stage),20000)
heartbeat.unref()
const checks = []
const pass = text => { checks.push(text); console.log('PASS ' + text) }
try {
  const owner = await provider.getSigner(0), buyerSigner = await provider.getSigner(1)
  const ownerAddress = await owner.getAddress(), buyer = await buyerSigner.getAddress()
  const outsider = await (await provider.getSigner(2)).getAddress()
  const deploy = async (file,name,args) => {
    const a = compiled.contracts[file][name]
    const c = await new ContractFactory(a.abi,a.evm.bytecode.object,owner).deploy(...args)
    await c.waitForDeployment()
    return c
  }
  const descriptor = await deploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[TRAIT_COUNTS,MAX_SUPPLY])
  const renderer = await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[descriptor.target])
  const nft = await deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[descriptor.target,renderer.target,ownerAddress,ownerAddress,100,ownerAddress])
  const receipt = await nft.deploymentTransaction().wait()
  await (await nft.setAllowlistAllocations([buyer],[2])).wait()
  await (await nft.startAllowlistSale()).wait()
  const deployment = {id:'check-local',label:'Check',networkName:'Check local',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',
    chainId:31337,address:nft.target,rpcUrl:'https://rpc.audit.invalid',deploymentBlock:receipt.blockNumber,
    deploymentHash:(await provider.getBlock(receipt.blockNumber)).hash,codeHash:keccak256(await provider.getCode(nft.target)),
    catalogHash:catalogFingerprint().sha256,mintEvidenceUrl:'https://allowlist.audit.invalid/mint-events'}
  const config = {version:1,projectId:'',activeDeployment:deployment.id,deployments:[deployment]}
  const bundle = await build({entryPoints:['apps/web/src/chain-ui.js'],outdir:'assets/web3',entryNames:'app',chunkNames:'chunk-[hash]',
    bundle:true,splitting:true,format:'esm',platform:'browser',target:['es2022'],write:false,logLevel:'silent',
    define:{__TRAIT_COUNTS__:JSON.stringify(TRAIT_COUNTS),__CATALOG_HASH__:JSON.stringify(deployment.catalogHash),
      __GENOTYPE_SPACE__:String(MAX_SUPPLY),__CHAIN_CONFIG_PATH__:'"chain-config.json"','process.env.NODE_ENV':'"production"'}})
  const files = new Map(bundle.outputFiles.map(file => ['/'+path.relative(process.cwd(),file.path),file.contents]))
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:!manualVisual,args:['--no-sandbox']})
  page = await browser.newPage()
  const errors = []
  let sent = 0,offline = false
  page.on('pageerror',error => errors.push(error.message))
  await page.setViewport({width:1440,height:1000})
  await page.exposeFunction('auditWalletRPC', async request => {
    if (request.method === 'eth_sendTransaction') sent++
    return local.request(request)
  })
  await page.evaluateOnNewDocument(({buyer}) => {
    const listeners = {}
    window.auditWallet = {account:buyer,chain:'0x7a69',reject:false}
    window.auditEmit = (name,value) => (listeners[name]||[]).forEach(fn => fn(value))
    window.ethereum = {
      on(name,fn) { (listeners[name]||=[]).push(fn) },
      removeListener(name,fn) { listeners[name]=(listeners[name]||[]).filter(f=>f!==fn) },
      async request({method,params=[]}) {
        if (method==='eth_accounts'||method==='eth_requestAccounts') return [window.auditWallet.account]
        if (method==='eth_chainId') return window.auditWallet.chain
        if (method==='wallet_switchEthereumChain') {
          window.auditWallet.chain=params[0].chainId
          window.auditEmit('chainChanged',params[0].chainId)
          return null
        }
        if (method==='eth_sendTransaction'&&window.auditWallet.reject) {
          window.auditWallet.reject=false
          throw Object.assign(Error('User rejected'),{code:4001})
        }
        return window.auditWalletRPC({method,params})
      }
    }
    window.addEventListener('myfriends:state',event=>{window.auditState=event.detail})
  },{buyer})
  await page.setRequestInterception(true)
  page.on('request',async request => {
    try {
      const url = new URL(request.url())
      if (url.hostname==='rpc.audit.invalid') {
        if (offline) return request.abort('failed')
        const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'content-type'}
        if (request.method()==='OPTIONS') return request.respond({status:204,headers})
        const data = JSON.parse(request.postData())
        const run = async r => {
          try {return {jsonrpc:'2.0',id:r.id,result:await local.request({method:r.method,params:r.params||[]})}}
          catch(e) {return {jsonrpc:'2.0',id:r.id,error:{code:e.code||-32000,message:e.message,data:e.data}}}
        }
        return request.respond({status:200,headers,contentType:'application/json',
          body:JSON.stringify(Array.isArray(data)?await Promise.all(data.map(run)):await run(data))})
      }
      if (url.origin!=='https://allowlist.audit.invalid') return request.respond({status:404,body:''})
      if (url.pathname==='/mint-events') {
        mintEvidence.push(JSON.parse(request.postData()))
        return request.respond({status:204,headers:{'access-control-allow-origin':'https://allowlist.audit.invalid'}})
      }
      if (url.pathname==='/chain-config.json') return request.respond({status:200,contentType:'application/json',body:JSON.stringify(config)})
      const filename = url.pathname==='/'?'/index.html':url.pathname
      if (filename.includes('..')||filename.split('/').some(s=>s.startsWith('.'))) return request.respond({status:403})
      const body = files.get(filename)||await readFile(path.join(process.cwd(),siteSourcePath(filename)))
      const type = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(filename)]||'application/octet-stream'
      return request.respond({status:200,contentType:type,body:Buffer.from(body)})
    } catch { if (!request.isInterceptResolutionHandled()) await request.respond({status:404,body:''}) }
  })
  const ready = () => page.waitForFunction(()=>window.auditState?.ready&&window.auditState?.account&&!window.auditState?.walletChecking,{timeout:30000})
  const load = async () => { await page.goto('https://allowlist.audit.invalid/'); await ready() }
  const select = async g => {
    await page.evaluate(g=>{location.hash='#genotype='+g.join(',')},g)
    await page.waitForFunction(g=>document.querySelector('#preview').dataset.genotype===g.join(','),{},g)
  }
  const close = () => page.$eval('#mintDialog',d=>new Promise(resolve=>{
    if (!d.open) return resolve()
    d.addEventListener('close',resolve,{once:true})
    d.close()
  }))
  const clickMint = () => page.$eval('#mint',b=>b.click())
  const bodyHas = text => page.waitForFunction(t=>document.querySelector('#mintDialog').open&&document.querySelector('#mintBody').textContent.includes(t),{},text)
  const waitForEvidence = async predicate => {
    for(let i=0;i<100;i++){
      if(mintEvidence.some(predicate))return
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.fail('Timed out waiting for mint evidence')
  }
  const noOverflow = async () => assert.equal(await page.evaluate(()=>{
    const dialog=document.querySelector('#mintDialog'),scroll=document.querySelector('.mint-scroll'),box=dialog.getBoundingClientRect()
    return dialog.open&&box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight&&dialog.scrollWidth<=dialog.clientWidth&&scroll.scrollWidth<=scroll.clientWidth
  }),true,'Allowlist mint dialog overflows the viewport')
  const capturePreview = async label => {
    const original=page.viewport(),filename=previewSteps[label]||label
    for (const {directory,width,height} of previewViewports) {
      await page.setViewport({width,height})
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      await noOverflow()
      if (width<=600) {
        const heightNow=Math.round(await page.$eval('.mint-art',node=>node.getBoundingClientRect().height))
        assert.ok(heightNow>=131,`Allowlist mint artwork is too small at ${width}px: ${heightNow}px`)
        if (allowlistArtHeights.has(width)) assert.equal(heightNow,allowlistArtHeights.get(width),`Allowlist mint artwork height changed at ${width}px`)
        else allowlistArtHeights.set(width,heightNow)
      }
      await mkdir(`${previewRoot}/${directory}/allowlist`,{recursive:true})
      await page.screenshot({path:`${previewRoot}/${directory}/allowlist/${filename}.png`})
      if (manualVisual&&directory==='mobile-390') {
        process.stdout.write('\x07')
        await prompts.question(`MANUAL: inspect allowlist ${filename} at ${width}px and press Enter here to continue. `)
      }
    }
    await page.setViewport(original)
  }
  stage = 'wallet restoration, rejection, successful mint'
  await load()
  assert.equal(await page.$eval('#wallet',b=>b.textContent),'WALLET MENU')
  pass('Authorized injected wallet restores automatically with current WALLET MENU label')
  await select([1,2,3,4,1,2])
  await page.evaluate(()=>{window.auditWallet.reject=true})
  await clickMint()
  await bodyHas('You cancelled in your wallet')
  await capturePreview('wallet-rejected')
  assert.equal(sent,0)
  assert.equal(await nft.allowlistClaimed(buyer),0n)
  await close()
  pass('Rejected signature consumes neither a transaction nor a claim')
  await clickMint()
  await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your myFriend is here!',{timeout:30000})
  await capturePreview('success')
  assert.equal(sent,1)
  assert.equal(await nft.ownerOf(1),buyer)
  assert.equal(await nft.allowlistClaimed(buyer),1n)
  assert.equal(await nft.tokenForTraits(1,2,3,4,1,2),1n)
  assert.equal(await page.evaluate(()=>window.myFriendsUI.owned().length),1)
  await waitForEvidence(event=>event.stage==='confirmed'&&event.transactionHash)
  const confirmedEvidence=mintEvidence.find(event=>event.stage==='confirmed')
  const confirmedJourney=mintEvidence.filter(event=>event.evidenceId===confirmedEvidence.evidenceId)
  assert.deepEqual(confirmedJourney.map(event=>event.stage),['intent','submitted','confirmed'])
  assert.equal(confirmedEvidence.wallet.toLowerCase(),buyer.toLowerCase())
  assert.equal(confirmedJourney.some(event=>'country' in event||'ip' in event),false,'Browser invented location evidence')
  await close()
  await load()
  assert.equal(await page.evaluate(()=>window.myFriendsUI.owned().length),1)
  pass('One click submits one free allowlist mint, ownership/traits/quota agree and collection survives reload')
  stage = 'pending mint reload and duplicate blocking'
  await select([2,2,3,4,1,2])
  await local.request({method:'miner_stop',params:[]})
  await clickMint()
  await bodyHas('Transaction sent')
  await capturePreview('pending')
  assert.equal(sent,2)
  await page.reload()
  await ready()
  await clickMint()
  assert.equal(sent,2)
  await local.request({method:'miner_start',params:[1]})
  await page.waitForFunction(()=>document.querySelector('#mintTitle').textContent==='Your myFriend is here!',{timeout:60000})
  assert.equal(await nft.allowlistClaimed(buyer),2n)
  assert.equal(await page.evaluate(()=>window.myFriendsUI.owned().length),2)
  await close()
  pass('Reload recovers pending transaction without another send, receipt produces the second NFT')
  stage = 'exhausted quota, outsider and account changes'
  await select([3,2,3,4,1,2])
  await clickMint()
  await bodyHas('Allowlist complete')
  await capturePreview('quota-complete')
  assert.equal(sent,2)
  assert.equal(await page.$$eval('#mintBody .wallet-friend-mini',nodes=>nodes.length),2)
  await close()
  await page.evaluate(outsider=>{window.auditWallet.account=outsider;window.auditEmit('accountsChanged',[outsider])},outsider)
  await clickMint()
  await bodyHas('no allowlist')
  await capturePreview('not-eligible')
  assert.equal(sent,2)
  assert.equal(await page.evaluate(()=>window.myFriendsUI.owned().length),0)
  await close()
  pass('Exhausted wallet shows its two NFT previews, outsider has no mint and does not inherit the prior collection')
  stage = 'temporary RPC outage'
  await page.evaluate(buyer=>{window.auditWallet.account=buyer;window.auditEmit('accountsChanged',[buyer])},buyer)
  offline = true
  await page.reload()
  await page.waitForFunction(()=>document.body.dataset.ready==='true')
  assert.equal(sent,2)
  offline = false
  await page.reload()
  await ready()
  assert.equal(await page.evaluate(()=>window.myFriendsUI.owned().length),2)
  assert.equal(sent,2)
  pass('RPC outage does not trigger a transaction, online reload recovers both NFTs')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({checks,transactions:sent,chainId:31337,realTransactions:0,browserErrors:errors}))
  stage = 'uncached RPC outage must not claim wallet is empty'
  await page.evaluate(()=>{
    for(const key of Object.keys(localStorage)) if(key.startsWith('myfriends:snapshot:')) localStorage.removeItem(key)
  })
  offline = true
  await page.reload()
  await page.waitForFunction(()=>window.auditState?.account&&!window.auditState.walletChecking)
  const unknown = await page.$eval('#myfriends-gallery',node=>node.textContent)
  assert.doesNotMatch(unknown,/No myFriends are held by this address yet|A quiet wallet/,
    'Connected wallet owns two NFTs, but unavailable uncached RPC data is displayed as an empty wallet')
  pass('Unknown ownership during uncached RPC outage is not presented as an empty wallet')
} catch (error) {
  console.error('FAILED STAGE: '+stage)
  if (page) console.error(JSON.stringify(await page.evaluate(()=>({
    title:document.querySelector('#mintTitle')?.textContent,
    body:document.querySelector('#mintBody')?.textContent,
    status:document.querySelector('#chainStatus')?.textContent,
    busy:window.auditState?.busy,ready:window.auditState?.ready,
    pending:Object.keys(localStorage).filter(k=>k.startsWith('myfriends:pending:')).map(k=>JSON.parse(localStorage.getItem(k)))
  }))))
  throw error
} finally {
  clearInterval(heartbeat)
  prompts?.close()
  if (browser) await browser.close()
  provider.destroy()
  await local.disconnect()
}
