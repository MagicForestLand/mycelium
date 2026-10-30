import {keccak256,toUtf8Bytes} from 'ethers';
import {createHash} from 'node:crypto';
import {layerKeys,renderLayerKeys,traits,beadPalette} from '../../collection/source/art.js';
import {MAX_SUPPLY} from '../../collection/source/token-id.js';
import {generateBanks} from './generate-banks.mjs';
import {collectionCopy,collectionDescription} from '../../collection/source/editorial.js';
import {validateRoleAddresses} from './deployment-roles.mjs';
export function validateDeploymentConfig(config){
  if(!config||!Number.isSafeInteger(config.chainId)||config.chainId<=0)throw new Error('Set an explicit target chainId');
  if(Object.hasOwn(config,'phenotypeAdmin'))throw new Error('phenotypeAdmin is obsolete; explicitly migrate the full collection owner to initialOwner and prepare a new manifest');
  validateRoleAddresses(config);
  if(!Number.isSafeInteger(config.saleCap)||config.saleCap<1||config.saleCap>MAX_SUPPLY)throw new Error('Invalid saleCap for this catalog');
  if(config.royaltyBps!==500)throw new Error('Initial royaltyBps must be 500 (5%); the contract enforces this default and ceiling');
  return config;
}
export function deploymentPlan(config){
  validateDeploymentConfig(config);
  const banks=generateBanks(traits,layerKeys).manifest,steps=[];
  const add=(name,file,args=[])=>steps.push({name,file,args});
  for(const bank of banks){
    for(const page of bank.pages)add(page.name,'contracts/core/generated/ArtBanks.sol');
    add(bank.name,'contracts/core/generated/ArtBanks.sol',bank.pages.length?[bank.pages.map(p=>`$${p.name}`)]:[]);
  }
  add('MetadataEncoder','contracts/core/MetadataEncoder.sol');
  add('GenotypeDescriptor','contracts/core/GenotypeDescriptor.sol',[banks.map(b=>`$${b.name}`),'$MetadataEncoder']);
  add('PhenotypeRenderer','contracts/core/PhenotypeRenderer.sol',['$GenotypeDescriptor']);
  add('MyceliumFriends','contracts/core/MyceliumFriends.sol',['$GenotypeDescriptor','$PhenotypeRenderer',config.treasury,config.initialOwner,config.saleCap,config.royaltyReceiver]);
  return {config,banks,steps};
}
export const resolveArguments=(args,addresses)=>args.map(arg=>Array.isArray(arg)?resolveArguments(arg,addresses):typeof arg==='string'&&arg.startsWith('$')?(addresses[arg.slice(1)]??(()=>{throw new Error('Missing dependency '+arg)})()):arg);
export function catalogFingerprint(){
  const catalog={editorial:{collectionCopy,collectionDescription},layerOrder:layerKeys,renderOrder:renderLayerKeys,palette:beadPalette,traits:Object.fromEntries(layerKeys.map(key=>[key,traits[key].map(({id,name,description,data})=>({id,name,description,data}))]))};
  const json=JSON.stringify(catalog);
  return {sha256:createHash('sha256').update(json).digest('hex'),keccak256:keccak256(toUtf8Bytes(json)),counts:layerKeys.map(k=>traits[k].length),genotypeSpace:MAX_SUPPLY};
}
