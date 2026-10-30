import {TRAIT_COUNTS} from '../../collection/source/token-id.js';
import {build} from 'esbuild';
import {catalogFingerprint} from '../lib/deployment-plan.mjs';
import {mkdir,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SITE_MODES=new Set(['read-only','wallet']);

export async function buildWeb3(siteMode='wallet'){
  if(!SITE_MODES.has(siteMode))throw Error('Web3 build mode must be read-only or wallet.');
  const walletBundle=siteMode==='wallet';
  const plugins=walletBundle?[]:[{
    name:'omit-wallet-bundle',
    setup(context){
      context.onLoad({filter:/\/apps\/web\/src\/chain-ui\.js$/},async args=>{
        const source=await readFile(args.path,'utf8'),walletImport="import('./wallet-appkit.js')";
        if(source.split(walletImport).length!==2)throw Error('Expected one wallet module import in chain-ui.js.');
        return {contents:source.replace(walletImport,"Promise.reject(new Error('Wallet support is not present in this read-only build.'))"),loader:'js'};
      });
    }
  }];
  const result=await build({entryPoints:['apps/web/src/chain-ui.js'],outdir:'apps/web/assets/web3',entryNames:'app',chunkNames:'chunk-[hash]',
    bundle:true,splitting:true,format:'esm',platform:'browser',target:['es2022'],minify:true,
    define:{__WALLET_BUNDLE__:String(walletBundle),__TRAIT_COUNTS__:JSON.stringify(TRAIT_COUNTS),__CATALOG_HASH__:JSON.stringify(catalogFingerprint().sha256),__GENOTYPE_SPACE__:String(catalogFingerprint().genotypeSpace),__CHAIN_CONFIG_PATH__:'"chain-config.json"','process.env.NODE_ENV':'"production"'},
    plugins,metafile:true,write:false,logLevel:'warning'});
  await mkdir('apps/web/assets/web3',{recursive:true});
  for(const output of result.outputFiles.sort((a,b)=>Number(a.path.endsWith('/app.js'))-Number(b.path.endsWith('/app.js'))))await writeFile(output.path,output.contents);
  const current=new Set(result.outputFiles.map(file=>path.basename(file.path)));
  for(const file of await readdir('apps/web/assets/web3'))if(file.endsWith('.js')&&!current.has(file))await unlink(path.join('apps/web/assets/web3',file));
  await mkdir('.dev',{recursive:true});
  await writeFile('.dev/web3-build.json',JSON.stringify({format:1,siteMode,metafile:result.metafile}));
  console.log(walletBundle
    ?`Built web3 entry + ${result.outputFiles.length-1} lazy wallet/shared chunks. WalletConnect UI loads only on Connect.`
    :`Built read-only web3 entry + ${result.outputFiles.length-1} shared chunks. No wallet bundle emitted.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildWeb3(process.argv[2]);
