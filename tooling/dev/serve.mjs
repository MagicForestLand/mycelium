import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {brotliCompress,gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {Contract,JsonRpcProvider,isAddress,parseEther} from 'ethers';
import {siteSourcePath} from '../lib/site-paths.mjs';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.json':'application/json'};
const port=Number(process.env.PORT || 4173);
const compressBrotli=promisify(brotliCompress),compressGzip=promisify(gzip);
const compressible=new Set(['.html','.js','.css','.svg','.json']);
let funding=false;
http.createServer(async (req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/api/local/fund'){
      res.setHeader('Content-Type','application/json');
      // This development-only endpoint is never part of the static hosting export.
      // Require the exact browser origin, JSON, a loopback host and the configured local chain.
      const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
      if(req.method!=='POST'||!allowedHosts.includes(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`||req.headers['content-type']!=='application/json'){
        res.writeHead(403);res.end(JSON.stringify({error:'Local browser requests only.'}));return;
      }
      if(funding){res.writeHead(429);res.end(JSON.stringify({error:'A local funding request is already running.'}));return;}
      funding=true;
      let provider;
      try{
        let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error('Request too large.');}
        const {address,deploymentId}=JSON.parse(body);
        const config=JSON.parse(await readFile(path.join(root,'apps/web/chain-config.json'),'utf8'));
        const d=config.deployments.find(d=>d.id===deploymentId&&d.chainId===31337);
        if(!isAddress(address)||!d||d.rpcUrl!=='http://127.0.0.1:8545')throw Error('Choose a valid local wallet and deployment.');
        provider=new JsonRpcProvider(d.rpcUrl,undefined,{cacheTimeout:-1});provider.pollingInterval=100;
        if(Number((await provider.getNetwork()).chainId)!==31337)throw Error('Local chain required.');
        const signer=await provider.getSigner();
        const balance=await provider.getBalance(address);
        if(balance<parseEther('10'))await(await signer.sendTransaction({to:address,value:parseEther('10')-balance})).wait();
        if(d.saleLifecycle!=='phased-v1')throw Error('Redeploy the current phased contract before using the local faucet.');
        const nft=new Contract(d.address,['function salePhase() view returns(uint8)','function setAllowlistAllocations(address[],uint256[])','function allowlistAllocation(address) view returns(uint256)'],signer);
        if(await nft.salePhase()<2n && await nft.allowlistAllocation(address)<5n)await(await nft.setAllowlistAllocations([address],[5])).wait();
        res.writeHead(200);res.end(JSON.stringify({ok:true}));
      }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.shortMessage||error.message}));}
      finally{provider?.destroy();funding=false;}
      return;
    }
    const target=path.resolve(root,siteSourcePath(pathname));
    if(!target.startsWith(root+path.sep) || pathname.includes('node_modules') || pathname.split('/').some(p=>p.startsWith('.'))) {res.writeHead(403);res.end();return;}
    let data=await readFile(target);const extension=path.extname(target),headers={'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':'no-store'};
    if(data.length>1024&&compressible.has(extension)){
      const encoding=req.headers['accept-encoding']||'';
      if(/\bbr\b/.test(encoding)){data=await compressBrotli(data);headers['Content-Encoding']='br';}
      else if(/\bgzip\b/.test(encoding)){data=await compressGzip(data);headers['Content-Encoding']='gzip';}
      headers.Vary='Accept-Encoding';
    }
    headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Mycelium → http://127.0.0.1:${port}`));
