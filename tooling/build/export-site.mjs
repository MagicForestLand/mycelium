import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateDeployment} from '../../apps/web/src/chain-core.js';
import {catalogFingerprint} from '../lib/deployment-plan.mjs';
import {buildWeb3} from './build-web3.mjs';

const CANONICAL_ORIGIN='https://mycelium.magicforest.land';
const STYLE_ASSETS=Object.freeze(['assets/site.css','assets/chain.css','assets/protected-mint.css']);
const PUBLIC_ASSETS=Object.freeze([
  'output/branding/avatar.svg','output/branding/banner.svg','output/branding/preview.svg'
]);
const WEB_PUBLIC_ASSETS=Object.freeze(['assets/social/mycelium-friends-og.png']);
const REOWN_LICENSE_SOURCE='node_modules/@reown/appkit/LICENSE.md';
const sha256=content=>createHash('sha256').update(content).digest('hex');
const shortHash=content=>sha256(content).slice(0,12);
const DIRTY_PRODUCTION_SOURCE=/\b(?:sepolia|testnet)\b|mycelium-friends-sepolia|magicforest\.land\/api\/mycelium\/snapshot/i;
const SITE_MODES=new Set(['read-only','wallet']);

function selectedWeb3Outputs(metafile,mode){
  const outputs=metafile.outputs||{},entry='apps/web/assets/web3/app.js';
  if(!outputs[entry])throw Error('Missing current web3 entry point.');
  const selected=Object.keys(outputs).filter(file=>file.startsWith('apps/web/assets/web3/')&&file.endsWith('.js')).sort();
  for(const file of selected)for(const item of outputs[file].imports||[]){
    if(!item.external&&!outputs[item.path])throw Error(`Missing web3 dependency ${item.path}.`);
  }
  if(mode==='read-only'&&selected.some(file=>outputs[file].entryPoint==='apps/web/src/wallet-appkit.js'))throw Error('Read-only export includes wallet code.');
  return selected;
}

export function runtimeConfigFromRecords(record,site){
  if(record?.version!==1||record?.kind!=='MYCELIUM_VERIFIED_DEPLOYMENT'||record.releaseStatus!=='CURRENT_RELEASE')throw Error('A current verified deployment record is required.');
  if(record.network!=='mainnet'||record.chainId!==1)throw Error('Production export requires Ethereum mainnet.');
  if(!/^[a-f0-9]{64}$/i.test(record.releaseDigest||''))throw Error('Deployment record is missing its release digest.');
  if(site?.version!==1||site?.kind!=='MYCELIUM_PUBLIC_SITE_CONFIG')throw Error('Invalid public site configuration.');
  if(!SITE_MODES.has(site.mode))throw Error('Set an explicit read-only or wallet site mode.');
  let wallet={};
  if(site.mode==='wallet'){
    if(!/^[a-f0-9]{32}$/i.test(site.projectId||''))throw Error('Set the final public Reown Project ID.');
    const metadata=site.walletMetadata;
    if(!metadata||metadata.url!==CANONICAL_ORIGIN+'/'||typeof metadata.name!=='string'||!metadata.name.trim()||typeof metadata.description!=='string'||!metadata.description.trim()||!Array.isArray(metadata.icons))throw Error('Invalid canonical wallet metadata.');
    for(const icon of metadata.icons){const url=new URL(icon);if(url.protocol!=='https:'||url.origin!==CANONICAL_ORIGIN)throw Error('Wallet icons must use the canonical HTTPS origin.');}
    wallet={projectId:site.projectId,walletMetadata:metadata};
  }else if(Object.hasOwn(site,'projectId')||Object.hasOwn(site,'walletMetadata'))throw Error('Read-only site configuration must omit wallet settings.');
  const publicDeployment=site.deployment;
  if(!publicDeployment||typeof publicDeployment!=='object')throw Error('Missing public deployment configuration.');
  if(typeof publicDeployment.snapshotUrl!=='string'||new URL(publicDeployment.snapshotUrl).protocol!=='https:')throw Error('Set the reviewed HTTPS production snapshot API.');
  if(typeof publicDeployment.profilesUrl!=='string'||new URL(publicDeployment.profilesUrl).protocol!=='https:')throw Error('Set the reviewed HTTPS minter profile API.');
  if(typeof publicDeployment.mintEvidenceUrl!=='string'||new URL(publicDeployment.mintEvidenceUrl).protocol!=='https:')throw Error('Set the reviewed HTTPS mint evidence API.');
  if(!publicDeployment.explorers||publicDeployment.explorers.etherscan!=='https://etherscan.io'||publicDeployment.explorers.evmNow!=='https://evm.now')throw Error('Production explorers must be Etherscan and EVM.NOW.');
  const deployment=validateDeployment({
    mintProtocol:record.protocol?.mint,
    saleLifecycle:record.protocol?.saleLifecycle,
    id:publicDeployment.id,
    label:publicDeployment.label,
    chainId:record.chainId,
    networkName:publicDeployment.networkName,
    rpcUrl:publicDeployment.rpcUrl,
    explorerUrl:publicDeployment.explorers.etherscan,
    explorers:publicDeployment.explorers,
    snapshotUrl:publicDeployment.snapshotUrl,
    profilesUrl:publicDeployment.profilesUrl,
    mintEvidenceUrl:publicDeployment.mintEvidenceUrl,
    address:record.collection?.address,
    deploymentBlock:record.deploymentBlock,
    deploymentHash:record.deploymentHash,
    codeHash:record.collection?.runtimeHash,
    catalogHash:record.collection?.catalogHash
  });
  const fingerprint=catalogFingerprint().sha256;
  if(deployment.catalogHash!==fingerprint)throw Error('The deployment record does not match this catalog build.');
  return {version:1,mode:site.mode,...wallet,activeDeployment:deployment.id,deployments:[deployment]};
}

export async function exportSite(deploymentPath,siteConfigPath){
  const [record,site,web3Build]=await Promise.all([
    readFile(deploymentPath,'utf8').then(JSON.parse),
    readFile(siteConfigPath,'utf8').then(JSON.parse),
    readFile('.dev/web3-build.json','utf8').then(JSON.parse)
  ]);
  const config=runtimeConfigFromRecords(record,site);
  if(web3Build?.format!==1||web3Build.siteMode!==config.mode||!web3Build.metafile)throw Error(`Build web3 assets in ${config.mode} mode before exporting.`);
  const out='output/site';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
  const exported=new Map();
  const emit=async(file,content)=>{const target=path.join(out,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);exported.set(file,sha256(content));};
  const copy=async(source,target=source)=>emit(target,await readFile(source));

  for(const file of PUBLIC_ASSETS)await copy(file);
  for(const file of WEB_PUBLIC_ASSETS)await copy(path.join('apps/web',file),file);
  await copy(REOWN_LICENSE_SOURCE,'reown-community-license.txt');
  const web3Outputs=selectedWeb3Outputs(web3Build.metafile,config.mode);
  if(!web3Outputs.includes('apps/web/assets/web3/app.js')||(config.mode==='wallet'&&web3Outputs.length<2))throw Error('Missing current web3 build graph.');
  const appSource=await readFile('apps/web/assets/web3/app.js');
  const appName=`assets/web3/app.${shortHash(appSource)}.js`;
  await emit(appName,appSource);
  for(const file of web3Outputs)if(file!=='apps/web/assets/web3/app.js')await copy(file,file.slice('apps/web/'.length));

  const [htmlSource,mainSource,...styles]=await Promise.all(['index.html','mycelium.bundle.js',...STYLE_ASSETS].map(file=>readFile(path.join('apps/web',file))));
  if(DIRTY_PRODUCTION_SOURCE.test(htmlSource.toString())||DIRTY_PRODUCTION_SOURCE.test(mainSource.toString()))throw Error('Production entry points contain a test-network or retired snapshot reference.');
  const mainName=`mycelium.bundle.${shortHash(mainSource)}.js`;
  await emit(mainName,mainSource);
  const styleNames=STYLE_ASSETS.map((file,index)=>{
    const parsed=path.parse(file);return path.join(parsed.dir,`${parsed.name}.${shortHash(styles[index])}${parsed.ext}`);
  });
  for(let i=0;i<styleNames.length;i++)await emit(styleNames[i],styles[i]);
  let html=htmlSource.toString().replace('mycelium.bundle.js',mainName).replace('assets/web3/app.js',appName);
  for(let i=0;i<styleNames.length;i++)html=html.replace(STYLE_ASSETS[i],styleNames[i]);
  if(STYLE_ASSETS.some(file=>html.includes(file))||html.includes('assets/web3/app.js')||html.includes('mycelium.bundle.js'))throw Error('Production HTML still references unhashed entry points.');
  await emit('index.html',html);
  await emit('chain-config.json',JSON.stringify(config,null,2)+'\n');
  const manifest={format:1,kind:'MYCELIUM_STATIC_SITE',siteMode:config.mode,releaseDigest:record.releaseDigest,sourceCommit:record.sourceCommit,canonicalOrigin:CANONICAL_ORIGIN+'/',files:Object.fromEntries([...exported].sort(([a],[b])=>a.localeCompare(b)))};
  await emit('site-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(`Static site: ${out}. Collection: ${config.deployments[0].label}. ${exported.size} explicit public files. No upload performed.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [deploymentPath='deployments/core/ethereum/mainnet.json',siteConfigPath='apps/web/config/mainnet-site.json']=process.argv.slice(2);
  const [record,site]=await Promise.all([deploymentPath,siteConfigPath].map(file=>readFile(file,'utf8').then(JSON.parse)));
  runtimeConfigFromRecords(record,site);
  await buildWeb3(site.mode);
  await exportSite(deploymentPath,siteConfigPath);
}
